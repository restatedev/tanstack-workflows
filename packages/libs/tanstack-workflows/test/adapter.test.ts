import { describe, expect, it, vi } from "vitest";
import type { Context } from "@restatedev/restate-sdk";
import { runHandler } from "../src/restate-workflow.js";
import { createWorkflow } from "@tanstack/workflow-core";
import { checkout } from "./checkout.js";

/**
 * Minimal in-memory stand-in for a Restate Context. `run` executes the step
 * body immediately (no journaling), `signal` resolves with a caller-provided
 * value so the approval path can be exercised synchronously.
 */
function mockCtx(opts: {
  key?: string;
  approval?: { approved: boolean; feedback?: string };
}) {
  const runCalls: Array<string> = [];
  const ctx = {
    request: () => ({ idempotencyKey: opts.key }),
    run: vi.fn((name: string, fn: () => unknown) => {
      runCalls.push(name);
      return Promise.resolve(fn());
    }),
    sleep: vi.fn(async () => {}),
    date: { now: vi.fn(async () => 1_700_000_000_000) },
    rand: { uuidv4: vi.fn(() => "uuid-fixed"), random: () => 0.5 },
    signal: vi.fn(() => Promise.resolve(opts.approval ?? { approved: true })),
    console,
  };
  return { ctx: ctx as unknown as Context, runCalls, spies: ctx };
}

describe("restate adapter", () => {
  it("runs the no-approval path, mapping ctx.step → ctx.run", async () => {
    const { ctx, runCalls } = mockCtx({ key: "run1" });
    const output = await runHandler(checkout, ctx, {
      userId: "cus_123",
      amount: 4200,
    });
    expect(output).toEqual({ status: "approved" });
    // Both steps became Restate journal entries (ctx.run), no approval.
    expect(runCalls).toEqual(["charge-card", "send-receipt"]);
  });

  it("runs the approval path via a named signal", async () => {
    const { ctx, runCalls, spies } = mockCtx({
      key: "run2",
      approval: { approved: true },
    });
    const output = await runHandler(checkout, ctx, {
      userId: "cus_123",
      amount: 20_000,
    });
    expect(output).toEqual({ status: "approved" });
    expect(runCalls).toContain("charge-card");
    // The run waited on the named signal of its approval id.
    expect(spies.signal).toHaveBeenCalledWith("approval:manager");
  });

  it("rejects when the approver denies the charge", async () => {
    const { ctx } = mockCtx({ key: "run3", approval: { approved: false } });
    const output = await runHandler(checkout, ctx, {
      userId: "cus_123",
      amount: 20_000,
    });
    expect(output).toEqual({ status: "rejected" });
  });

  it("validates input via the workflow schema", async () => {
    const { ctx } = mockCtx({ key: "run4" });
    await expect(
      runHandler(checkout, ctx, { userId: "cus_123" })
    ).rejects.toThrow(/input validation failed/);
  });

  it("requires an idempotency key as runId", async () => {
    const { ctx } = mockCtx({});
    await expect(
      runHandler(checkout, ctx, { userId: "cus_123", amount: 1 })
    ).rejects.toThrow(/idempotency key/);
  });

  it("requires an id on approve()", async () => {
    const { ctx } = mockCtx({ key: "run5" });
    const noId = createWorkflow({ id: "no-id" }).handler(async (wf) => {
      await wf.approve({ title: "Approve?" });
      return {};
    });
    await expect(runHandler(noId, ctx, undefined)).rejects.toThrow(
      /needs an `id`/
    );
  });
});
