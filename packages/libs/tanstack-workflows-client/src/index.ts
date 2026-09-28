// Client for workflows mounted with `restateWorkflows(...)` from
// `@restatedev/tanstack-workflows`, shaped after the `@tanstack/workflow-runtime`
// driver (`startRun` / `deliverSignal` / `deliverApproval`). A run is addressed
// by its `runId`, which is the idempotency key of the `run` invocation.
//
// Everything goes through `@restatedev/restate-sdk-clients`, except the ingress
// endpoints it doesn't cover yet: `lookup`, `output` (Restate >= 1.7) and
// `status` (Restate >= 1.8).

import * as clients from "@restatedev/restate-sdk-clients";
import {
  workflowInterface,
  workflowSupportInterface,
} from "@restatedev/tanstack-workflows-interface";
import type { ApprovalResult } from "@tanstack/workflow-core";
import type {
  WorkflowExecution,
  WorkflowExecutionStatus,
  WorkflowRuntimeDeliverApprovalArgs,
  WorkflowRuntimeDeliverSignalArgs,
  WorkflowRuntimeRunResult,
  WorkflowRuntimeRunResultKind,
  WorkflowRuntimeStartRunArgs,
} from "@tanstack/workflow-runtime";

/**
 * Restate does the scheduling, so there are no leases, deadlines, thread ids
 * or event fan-out.
 */
export type RestateStartRunArgs<TInput = unknown> = Pick<
  WorkflowRuntimeStartRunArgs,
  "workflowId" | "runId"
> & { input: TInput };

/**
 * Unlike TanStack, `workflowId` is required: Restate finds a run by the
 * workflow's service and the `runId`.
 */
export type RestateDeliverSignalArgs<TPayload = unknown> = Pick<
  WorkflowRuntimeDeliverSignalArgs<TPayload>,
  "runId" | "signalId" | "name" | "payload"
> & { workflowId: string };

/**
 * Unlike TanStack, `workflowId` is required: Restate finds a run by the
 * workflow's service and the `runId`.
 */
export type RestateDeliverApprovalArgs = Pick<
  WorkflowRuntimeDeliverApprovalArgs,
  "runId"
> & {
  workflowId: string;
  approval: Omit<ApprovalResult, "meta">;
};

/**
 * `running` when the run was started / the delivery accepted, `duplicate` on
 * a repeated `runId` / `signalId` / `approvalId`, `not-found` for unknown
 * runs. Deliveries that arrive before the run waits for them are buffered, so
 * there is no `not-waiting`.
 */
export type RestateWorkflowRunResult = Pick<
  WorkflowRuntimeRunResult,
  "runId" | "workflowId"
> & {
  kind: Extract<
    WorkflowRuntimeRunResultKind,
    "running" | "duplicate" | "not-found"
  >;
};

/** A run as far as Restate can tell: no `paused`, `awaiting` or timestamps. */
export type RestateWorkflowExecution<O = unknown> = Pick<
  WorkflowExecution,
  "runId" | "workflowId" | "error"
> & {
  status: Extract<
    WorkflowExecutionStatus,
    "queued" | "running" | "finished" | "errored"
  >;
  /** Set when `status` is `finished`. */
  output?: O;
};

/** Response of the ingress `status` endpoint. */
interface InvocationStatus {
  stage: "created" | "started" | "completed";
  error?: { code: number; message: string; stacktrace?: string };
}

const orNotFound = async <T>(p: Promise<T>): Promise<T | undefined> => {
  try {
    return await p;
  } catch (e) {
    if (e instanceof clients.HttpCallError && e.status === 404) return;
    throw e;
  }
};

// Each workflow is served by a service named after its id.
const target = (workflowId: string, runId: string) => ({
  target: "idempotentInvocation",
  service: workflowId,
  handler: "run",
  idempotencyKey: runId,
});

/**
 * Drive TanStack workflows running on Restate, with the same surface as the
 * `@tanstack/workflow-runtime` driver. Takes the Restate ingress connection,
 * e.g. `{ url: "http://localhost:8080" }`.
 */
export function createRestateWorkflowRuntime(opts: clients.ConnectionOpts) {
  const ingress = clients.connect(opts);
  const support = ingress.sendClient(workflowSupportInterface);

  const baseUrl = opts.url.replace(/\/+$/, "");
  const post = async (path: string, body: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...opts.headers,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new clients.HttpCallError(
        res.status,
        text,
        `Request failed: ${res.status}\n${text}`
      );
    }
    return text ? JSON.parse(text) : undefined;
  };

  const lookup = async (workflowId: string, runId: string): Promise<string> =>
    (
      (await post("/restate/lookup", target(workflowId, runId))) as {
        invocationId: string;
      }
    ).invocationId;

  // `lookup` resolves any key, so check the run exists before delivering.
  const existingInvocation = async (
    workflowId: string,
    runId: string
  ): Promise<string | undefined> => {
    const invocationId = await lookup(workflowId, runId);
    const status = await orNotFound(
      post("/restate/status", { target: "invocation", invocationId })
    );
    return status ? invocationId : undefined;
  };

  const deliver = async (
    workflowId: string,
    runId: string,
    send: (invocationId: string) => Promise<clients.Send<void>>
  ): Promise<RestateWorkflowRunResult> => {
    const invocationId = await existingInvocation(workflowId, runId);
    if (!invocationId) return { kind: "not-found", runId, workflowId };
    const { status } = await send(invocationId);
    return {
      kind: status === "Accepted" ? "running" : "duplicate",
      runId,
      workflowId,
    };
  };

  return {
    /** Start a run without waiting for it. Idempotent on `runId`. */
    async startRun<TInput = unknown>(
      args: RestateStartRunArgs<TInput>
    ): Promise<RestateWorkflowRunResult> {
      const { workflowId, runId, input } = args;
      // The typed signature drops `input` when it's void, which TS can't
      // resolve for a generic workflow; at runtime `(input, opts)` is accepted.
      const run = ingress.sendClient(workflowInterface(workflowId))
        .run as unknown as (
        input: unknown,
        opts: clients.SendOpts<unknown>
      ) => Promise<clients.Send<unknown>>;
      const { status } = await run(
        input,
        clients.rpc.sendOpts({ idempotencyKey: runId })
      );
      return {
        kind: status === "Accepted" ? "running" : "duplicate",
        runId,
        workflowId,
      };
    },

    /** Resolve a `ctx.waitForEvent(name)` of a run. */
    deliverSignal<TPayload = unknown>(
      args: RestateDeliverSignalArgs<TPayload>
    ): Promise<RestateWorkflowRunResult> {
      const { runId, workflowId, signalId, name, payload } = args;
      return deliver(workflowId, runId, (invocationId) =>
        support.signal(
          { invocationId, name, payload },
          clients.rpc.sendOpts({
            idempotencyKey: `${invocationId}:signal:${signalId}`,
          })
        )
      );
    },

    /** Resolve a `ctx.approve(...)` of a run. */
    deliverApproval(
      args: RestateDeliverApprovalArgs
    ): Promise<RestateWorkflowRunResult> {
      const { runId, workflowId, approval } = args;
      return deliver(workflowId, runId, (invocationId) =>
        support.approve(
          {
            invocationId,
            approvalId: approval.approvalId,
            approved: approval.approved,
            feedback: approval.feedback,
          },
          clients.rpc.sendOpts({
            idempotencyKey: `${invocationId}:approval:${approval.approvalId}`,
          })
        )
      );
    },

    /** Current state of a run, or `undefined` if it doesn't exist. */
    async getRun<TOutput = unknown>(
      workflowId: string,
      runId: string
    ): Promise<RestateWorkflowExecution<TOutput> | undefined> {
      const status = (await orNotFound(
        post("/restate/status", target(workflowId, runId))
      )) as InvocationStatus | undefined;
      if (!status) return;
      const run = { runId, workflowId };
      switch (status.stage) {
        case "created":
          return { ...run, status: "queued" };
        case "started":
          return { ...run, status: "running" };
        case "completed":
          if (status.error) {
            return {
              ...run,
              status: "errored",
              error: {
                // A completed Restate invocation only fails with a terminal error.
                name: "TerminalError",
                message: status.error.message,
                stack: status.error.stacktrace,
              },
            };
          }
          return {
            ...run,
            status: "finished",
            output: (await post(
              "/restate/output",
              target(workflowId, runId)
            )) as TOutput,
          };
      }
    },

    /** Wait for a run to finish and return its output; throws if it errored. */
    async attachRun<TOutput = unknown>(
      workflowId: string,
      runId: string
    ): Promise<TOutput> {
      return ingress.result<TOutput>({
        invocationId: await lookup(workflowId, runId),
        status: "PreviouslyAccepted",
        attachable: true,
      });
    },
  };
}

export type RestateWorkflowRuntime = ReturnType<
  typeof createRestateWorkflowRuntime
>;
