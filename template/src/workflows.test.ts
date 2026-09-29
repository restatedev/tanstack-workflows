import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { restateWorkflows } from "@restatedev/tanstack-workflows";
import {
  createRestateWorkflowRuntime,
  type RestateWorkflowRuntime,
} from "@restatedev/tanstack-workflows-client";
import { GenericContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkout } from "./workflows.js";

// Starts Restate in Docker, serves the workflow, and registers it.
describe("checkout", () => {
  let env: RestateTestEnvironment;
  let runtime: RestateWorkflowRuntime;

  beforeAll(async () => {
    env = await RestateTestEnvironment.start(
      { services: restateWorkflows(checkout) },
      () => new GenericContainer("ghcr.io/restatedev/restate:main")
    );
    runtime = createRestateWorkflowRuntime({ url: env.baseUrl() });
  }, 120_000);

  afterAll(async () => {
    await env?.stop();
  });

  it("completes small charges right away", async () => {
    await runtime.startRun({
      workflowId: "checkout",
      runId: "order-1",
      input: { userId: "cus_123", amount: 4200 },
    });
    expect(await runtime.attachRun("checkout", "order-1")).toEqual({
      status: "approved",
    });
  });

  it("waits for approval on large charges", async () => {
    await runtime.startRun({
      workflowId: "checkout",
      runId: "order-2",
      input: { userId: "cus_123", amount: 20_000 },
    });
    await runtime.deliverApproval({
      workflowId: "checkout",
      runId: "order-2",
      approval: { approvalId: "manager", approved: true },
    });
    expect(await runtime.attachRun("checkout", "order-2")).toEqual({
      status: "approved",
    });
  });

  it("rejects when the approval is denied", async () => {
    await runtime.startRun({
      workflowId: "checkout",
      runId: "order-3",
      input: { userId: "cus_123", amount: 20_000 },
    });
    await runtime.deliverApproval({
      workflowId: "checkout",
      runId: "order-3",
      approval: { approvalId: "manager", approved: false },
    });
    expect(await runtime.attachRun("checkout", "order-3")).toEqual({
      status: "rejected",
    });
  });
});
