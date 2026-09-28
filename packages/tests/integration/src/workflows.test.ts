import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { restateWorkflows } from "@restatedev/tanstack-workflows";
import {
  createRestateWorkflowRuntime,
  type RestateWorkflowRuntime,
} from "@restatedev/tanstack-workflows-client";
import { GenericContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approval, events, messages, steps } from "./workflows.js";

const services = restateWorkflows(steps, approval, events, messages);

// Needs Restate >= 1.8 (ingress `status` endpoint): defaults to the nightly build.
const RESTATE_IMAGE =
  process.env.RESTATE_IMAGE ?? "ghcr.io/restatedev/restate:main";

// Wait until the run started and had time to park on its wait, to exercise
// "signal after wait".
async function waitUntilStarted(
  runtime: RestateWorkflowRuntime,
  workflowId: string,
  runId: string
) {
  for (let i = 0; i < 100; i++) {
    if ((await runtime.getRun(workflowId, runId))?.status === "running") {
      await new Promise((r) => setTimeout(r, 300));
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`run ${runId} never started`);
}

// `alwaysReplay` replays on every suspension point, to catch non-determinism;
// the other mode keeps invocations running across waits, as in production.
describe.each([{ alwaysReplay: true }, { alwaysReplay: false }])(
  "tanstack workflows on restate (alwaysReplay: $alwaysReplay)",
  ({ alwaysReplay }) => {
    let env: RestateTestEnvironment;
    let runtime: RestateWorkflowRuntime;

    beforeAll(async () => {
      env = await RestateTestEnvironment.start({ services }, () =>
        new GenericContainer(RESTATE_IMAGE).withEnvironment(
          alwaysReplay
            ? { RESTATE_WORKER__INVOKER__INACTIVITY_TIMEOUT: "0s" }
            : {}
        )
      );
      runtime = createRestateWorkflowRuntime({ url: env.baseUrl() });
    });

    afterAll(async () => {
      await env?.stop();
    });

    it("runs steps and returns validated output", async () => {
      expect(
        await runtime.startRun({
          workflowId: "steps",
          runId: "run-1",
          input: { name: "restate" },
        })
      ).toEqual({ kind: "running", runId: "run-1", workflowId: "steps" });
      const out = await runtime.attachRun<{ greeting: string }>(
        "steps",
        "run-1"
      );
      expect(out.greeting).toBe("Hello, restate!");
    });

    it("is idempotent on runId", async () => {
      const start = {
        workflowId: "steps",
        runId: "run-idem",
        input: { name: "a" },
      } as const;
      await runtime.startRun(start);
      const first = await runtime.attachRun("steps", "run-idem");
      expect((await runtime.startRun(start)).kind).toBe("duplicate");
      expect(await runtime.attachRun("steps", "run-idem")).toEqual(first);
    });

    it("resumes on approval", async () => {
      await runtime.startRun({
        workflowId: "approval",
        runId: "run-approve",
        input: { amount: 100 },
      });
      await waitUntilStarted(runtime, "approval", "run-approve");
      expect(
        await runtime.deliverApproval({
          workflowId: "approval",
          runId: "run-approve",
          approval: { approvalId: "manager", approved: true },
        })
      ).toEqual({
        kind: "running",
        runId: "run-approve",
        workflowId: "approval",
      });
      expect(await runtime.attachRun("approval", "run-approve")).toEqual({
        status: "approved",
      });
    });

    it("resumes on rejection", async () => {
      await runtime.startRun({
        workflowId: "approval",
        runId: "run-reject",
        input: { amount: 100 },
      });
      await waitUntilStarted(runtime, "approval", "run-reject");
      await runtime.deliverApproval({
        workflowId: "approval",
        runId: "run-reject",
        approval: { approvalId: "manager", approved: false, feedback: "nope" },
      });
      expect(await runtime.attachRun("approval", "run-reject")).toEqual({
        status: "rejected",
      });
    });

    it("resumes on signal", async () => {
      await runtime.startRun({
        workflowId: "events",
        runId: "run-event",
        input: undefined,
      });
      await waitUntilStarted(runtime, "events", "run-event");
      await runtime.deliverSignal({
        workflowId: "events",
        runId: "run-event",
        signalId: "s1",
        name: "ping",
        payload: { value: "pong" },
      });
      expect(await runtime.attachRun("events", "run-event")).toEqual({
        received: "pong",
      });
    });

    it("buffers a signal sent right after start", async () => {
      await runtime.startRun({
        workflowId: "events",
        runId: "run-early",
        input: undefined,
      });
      await runtime.deliverSignal({
        workflowId: "events",
        runId: "run-early",
        signalId: "s1",
        name: "ping",
        payload: { value: "early" },
      });
      expect(await runtime.attachRun("events", "run-early")).toEqual({
        received: "early",
      });
    });

    it("dedups deliveries on signalId / approvalId", async () => {
      await runtime.startRun({
        workflowId: "events",
        runId: "run-dup",
        input: undefined,
      });
      const signal = {
        workflowId: "events",
        runId: "run-dup",
        signalId: "s1",
        name: "ping",
        payload: { value: "once" },
      };
      expect((await runtime.deliverSignal(signal)).kind).toBe("running");
      expect((await runtime.deliverSignal(signal)).kind).toBe("duplicate");
      expect(await runtime.attachRun("events", "run-dup")).toEqual({
        received: "once",
      });

      await runtime.startRun({
        workflowId: "approval",
        runId: "run-dup",
        input: { amount: 1 },
      });
      const decision = {
        workflowId: "approval",
        runId: "run-dup",
        approval: { approvalId: "manager", approved: true },
      };
      expect((await runtime.deliverApproval(decision)).kind).toBe("running");
      expect((await runtime.deliverApproval(decision)).kind).toBe("duplicate");
    });

    it("reports not-found for unknown runs", async () => {
      expect(await runtime.getRun("events", "does-not-exist")).toBeUndefined();
      expect(
        await runtime.deliverSignal({
          workflowId: "events",
          runId: "does-not-exist",
          signalId: "s1",
          name: "ping",
          payload: {},
        })
      ).toEqual({
        kind: "not-found",
        runId: "does-not-exist",
        workflowId: "events",
      });
      await expect(
        runtime.attachRun("events", "does-not-exist")
      ).rejects.toMatchObject({ status: 404 });
    });

    it("reports a finished run with its output", async () => {
      await runtime.startRun({
        workflowId: "approval",
        runId: "run-status",
        input: { amount: 1 },
      });
      await waitUntilStarted(runtime, "approval", "run-status");
      expect(await runtime.getRun("approval", "run-status")).toEqual({
        runId: "run-status",
        workflowId: "approval",
        status: "running",
      });
      await runtime.deliverApproval({
        workflowId: "approval",
        runId: "run-status",
        approval: { approvalId: "manager", approved: true },
      });
      await runtime.attachRun("approval", "run-status");
      expect(await runtime.getRun("approval", "run-status")).toEqual({
        runId: "run-status",
        workflowId: "approval",
        status: "finished",
        output: { status: "approved" },
      });
    });

    it("reports an errored run with its error", async () => {
      await runtime.startRun({
        workflowId: "approval",
        runId: "run-bad",
        input: { amount: "nope" },
      });
      await expect(runtime.attachRun("approval", "run-bad")).rejects.toThrow(
        /input validation failed/
      );
      expect(await runtime.getRun("approval", "run-bad")).toMatchObject({
        status: "errored",
        error: {
          name: "TerminalError",
          message: expect.stringMatching(/input validation failed/),
        },
      });
    });

    const sendMessages = async (runId: string, msgs: string[]) => {
      for (const [i, msg] of msgs.entries()) {
        expect(
          (
            await runtime.deliverSignal({
              workflowId: "messages",
              runId,
              signalId: `m${i}`,
              name: "msg",
              payload: msg,
            })
          ).kind
        ).toBe("running");
      }
    };

    it("delivers repeated signals of the same name in order", async () => {
      await runtime.startRun({
        workflowId: "messages",
        runId: "run-msgs",
        input: undefined,
      });
      await waitUntilStarted(runtime, "messages", "run-msgs");
      // Addressed by name, even though the first wait has an explicit id.
      await sendMessages("run-msgs", ["a", "b", "c", "done"]);
      expect(await runtime.attachRun("messages", "run-msgs")).toEqual({
        received: ["a", "b", "c"],
      });
    });

    it("queues repeated signals sent before the run waits", async () => {
      await runtime.startRun({
        workflowId: "messages",
        runId: "run-msgs-early",
        input: undefined,
      });
      await sendMessages("run-msgs-early", ["x", "y", "done"]);
      expect(await runtime.attachRun("messages", "run-msgs-early")).toEqual({
        received: ["x", "y"],
      });
    });
  }
);
