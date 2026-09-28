// The Restate service contracts of workflows registered with `restateWorkflows`
// from `@restatedev/tanstack-workflows`. Depends only on `@restatedev/restate-sdk-core`,
// so callers (ingress clients, browsers) can import it without the server SDK.

import { iface } from "@restatedev/restate-sdk-core";
import type {
  HandlerDescriptor,
  ServiceDescriptor,
} from "@restatedev/restate-sdk-core";

interface SignalRequest {
  /** Invocation id of the `run` invocation, from the ingress `lookup` API. */
  invocationId: string;
  /** Name passed to `ctx.waitForEvent(name)`. */
  name: string;
  payload?: unknown;
}

interface ApprovalRequest {
  /** Invocation id of the `run` invocation, from the ingress `lookup` API. */
  invocationId: string;
  approvalId: string;
  approved: boolean;
  feedback?: string;
}

/** The service of one workflow, named after its id. */
export type WorkflowInterface<I = unknown, O = unknown> = ServiceDescriptor<
  string,
  {
    /** Drives the workflow. Invoke with `idempotency-key = runId`. */
    run: HandlerDescriptor<I, O, false>;
  }
>;

/** The service contract of the workflow with the given `id`. */
export function workflowInterface<I = unknown, O = unknown>(
  id: string
): WorkflowInterface<I, O> {
  return iface.service(id, { run: iface.json<I, O>() });
}

/** Well-known service delivering signals and approvals to runs of any workflow. */
export const workflowSupportInterface = iface.service(
  "TanstackWorkflowSupport",
  {
    /** Resolves a pending `waitForEvent` on a run. */
    signal: iface.json<SignalRequest, void>(),
    /** Resolves a pending `approve` on a run. */
    approve: iface.json<ApprovalRequest, void>(),
  }
);

export type WorkflowSupportInterface = typeof workflowSupportInterface;
