// Adapter: run a `@tanstack/workflow-core` WorkflowDefinition on Restate.
//
// We do NOT use `runWorkflow` / `RunStore` (that would keep TanStack's replay
// engine as the executor and reduce Restate to a KV store). Instead we register
// each workflow as a plain Restate Service whose `run` handler is invoked with
// `idempotency-key = runId`, and build a `BaseCtx` whose durable primitives call
// the Restate Context directly — so `ctx.step` becomes a real Restate journal
// entry, `ctx.sleep` a Restate timer, and `waitForEvent`/`approve` named Restate
// signals on the `run` invocation.
//
// Callers address a run only by `runId`: the ingress `lookup`/`attach` APIs
// resolve the idempotency key to the invocation id / result.

import {
  implement,
  InvocationIdParser,
  TerminalError,
} from "@restatedev/restate-sdk";
import type {
  Context,
  InferInput,
  ServiceDefinition,
  RunOptions,
} from "@restatedev/restate-sdk";
import type {
  AnyWorkflowDefinition,
  ApproveOptions,
  ApprovalResult,
  BaseCtx,
  Ctx,
  SleepOptions,
  StepContext,
  StepOptions,
  WaitForEventOptions,
  WorkflowInput,
  WorkflowOutput,
  WorkflowRuntimeContext,
} from "@tanstack/workflow-core";
import {
  type WorkflowInterface,
  type WorkflowSupportInterface,
  workflowInterface,
  workflowSupportInterface,
} from "@restatedev/tanstack-workflows-interface";

type SupportHandlers = WorkflowSupportInterface["_handlers"];
type SignalRequest = InferInput<SupportHandlers["signal"]>;
type ApprovalRequest = InferInput<SupportHandlers["approve"]>;
import {
  buildInitialState,
  composeMiddlewares,
  validateStandard,
  validateWorkflowInput,
  validateWorkflowOutput,
} from "./middleware.js";

// Names of the Restate signals backing `waitForEvent` and `approve`. A named
// signal is a durable queue: each `ctx.signal(name)` receives the next
// resolution, and resolutions sent before the run waits are kept until it does.
// So repeated waits on the same name consume deliveries in order.
const eventSignal = (name: string) => `event:${name}`;
const approvalSignal = (id: string) => `approval:${id}`;

type ApprovalDecision = { approved: boolean; feedback?: string };

/** The runtime budget helpers are no-ops under Restate: it auto-suspends on
 *  awaits and does not run bounded execution slices, so there is nothing to
 *  yield and time is effectively unbounded. */
const unboundedRuntime: WorkflowRuntimeContext = {
  deadline: undefined,
  timeRemaining: () => Infinity,
  shouldYield: () => false,
  yield: async () => {},
};

function toRunOptions<T>(
  retry: StepOptions["retry"] | undefined
): RunOptions<T> {
  const options: RunOptions<T> = {};
  if (!retry) return options;
  options.maxRetryAttempts = retry.maxAttempts;
  if (retry.baseMs != null) options.initialRetryInterval = retry.baseMs;
  if (retry.backoff === "fixed") options.retryIntervalFactor = 1;
  // 'exponential' → Restate default factor (2); custom fn backoff and per-attempt
  // `timeout` have no direct Restate equivalent (documented fidelity gap).
  return options;
}

/** Build the TanStack `BaseCtx` backed by a Restate Context. */
function buildBaseCtx(
  ctx: Context,
  runId: string,
  def: AnyWorkflowDefinition,
  input: unknown,
  state: Record<string, unknown>
): BaseCtx<unknown, Record<string, unknown>> {
  // A run-level AbortSignal is part of the TanStack ctx contract; Restate owns
  // cancellation, so we hand out a controller that never fires.
  const abort = new AbortController();

  const step = <T>(
    id: string,
    fn: (stepCtx: StepContext) => T | Promise<T>,
    options?: StepOptions
  ): Promise<T> => {
    const retry = options?.retry ?? def.defaultStepRetry;
    const stepCtx: StepContext = {
      // Deterministic idempotency-key candidate for external systems, stable
      // across retries and replays — same guarantee as TanStack.
      id: `${runId}:${id}`,
      attempt: 1, // Restate manages retries opaquely; attempt is best-effort.
      runtime: unboundedRuntime,
      signal: abort.signal,
    };
    return ctx.run<T>(
      id,
      async () => {
        try {
          return await fn(stepCtx);
        } catch (err) {
          // Honor a `shouldRetry` predicate by converting a non-retryable error
          // into a TerminalError, which stops Restate's retry loop.
          if (retry?.shouldRetry && !retry.shouldRetry(err, stepCtx.attempt)) {
            throw new TerminalError(
              err instanceof Error ? err.message : String(err)
            );
          }
          throw err;
        }
      },
      toRunOptions<T>(retry)
    );
  };

  const sleep = async (ms: number, _options?: SleepOptions): Promise<void> => {
    await ctx.sleep(ms);
  };

  const sleepUntil = async (
    timestamp: number,
    _options?: SleepOptions
  ): Promise<void> => {
    const delta = timestamp - (await ctx.date.now());
    if (delta > 0) await ctx.sleep(delta);
  };

  const waitForEvent = async <TPayload = unknown>(
    name: string,
    options?: WaitForEventOptions<TPayload>
  ): Promise<TPayload> => {
    // Deliveries address a wait by `name`; `options.id` only identifies the
    // wait itself (its TanStack step id), so it's not part of the signal name.
    const signal = ctx.signal<TPayload>(eventSignal(name));
    const payload = await (options?.deadline != null
      ? signal.orTimeout(Math.max(options.deadline - (await ctx.date.now()), 0))
      : signal);
    if (options?.schema) {
      return validateStandard(
        options.schema,
        payload,
        `waitForEvent("${name}")`
      ) as TPayload;
    }
    return payload;
  };

  const approve = async (options: ApproveOptions): Promise<ApprovalResult> => {
    // Callers deliver approvals by id, and there's no way to discover a
    // generated one, so it must be given.
    const approvalId = options.id;
    if (!approvalId) {
      throw new TerminalError(
        `ctx.approve({ title: "${options.title}" }) needs an \`id\` on Restate: approvals are delivered by id`
      );
    }
    ctx.console.info(
      `[approval-requested] run=${runId} approvalId=${approvalId} title=${options.title}`
    );
    const decision = await ctx.signal<ApprovalDecision>(
      approvalSignal(approvalId)
    );
    return {
      approved: decision.approved,
      approvalId,
      feedback: decision.feedback,
    };
  };

  const now = async (): Promise<number> => ctx.date.now();
  const uuid = async (): Promise<string> => ctx.rand.uuidv4();
  const emit = (name: string, value: Record<string, unknown>): void => {
    ctx.console.info(`[emit] ${name}`, value);
  };

  return {
    runId,
    input,
    state,
    signal: abort.signal,
    runtime: unboundedRuntime,
    step,
    sleep,
    sleepUntil,
    waitForEvent,
    approve,
    now,
    uuid,
    emit,
  };
}

// ── Handler bodies (exported as plain functions for unit testing) ──────────

/** The `run` handler: drive the TanStack handler on Restate. */
export async function runHandler(
  def: AnyWorkflowDefinition,
  ctx: Context,
  rawInput: unknown
): Promise<unknown> {
  // Requires service protocol v7 (Restate >= 1.7 with
  // RESTATE_EXPERIMENTAL_ENABLE_PROTOCOL_V7 + RESTATE_EXPERIMENTAL_ENABLE_VQUEUES).
  const runId = ctx.request().idempotencyKey;
  if (!runId) {
    throw new TerminalError(
      `Workflow "${def.id}" must be invoked with an idempotency key (the runId)`
    );
  }
  const input = validateWorkflowInput(def, rawInput);
  const state = buildInitialState(def, input);
  const baseCtx = buildBaseCtx(ctx, runId, def, input, state);
  const output = await composeMiddlewares(
    def.middlewares,
    baseCtx as Ctx<any, any, any>,
    def.handler as (ctx: Ctx<any, any, any>) => Promise<unknown>
  );
  return validateWorkflowOutput(def, output);
}

/** `signal` handler: resolve a `waitForEvent(name)` on a run. */
export async function signalHandler(
  ctx: Context,
  arg: SignalRequest
): Promise<void> {
  ctx
    .invocation(InvocationIdParser.fromString(arg.invocationId))
    .signal(eventSignal(arg.name))
    .resolve(arg.payload);
}

/** `approve` handler: resolve an `approve()` on a run. */
export async function approveHandler(
  ctx: Context,
  arg: ApprovalRequest
): Promise<void> {
  ctx
    .invocation(InvocationIdParser.fromString(arg.invocationId))
    .signal<ApprovalDecision>(approvalSignal(arg.approvalId))
    .resolve({ approved: arg.approved, feedback: arg.feedback });
}

/** The Restate service of a TanStack `WorkflowDefinition`. */
export type RestateWorkflow<D extends AnyWorkflowDefinition> =
  ServiceDefinition<string, unknown> &
    WorkflowInterface<WorkflowInput<D>, WorkflowOutput<D>>;

export type RestateWorkflowSupport = ServiceDefinition<string, unknown> &
  WorkflowSupportInterface;

function restateWorkflow<D extends AnyWorkflowDefinition>(
  def: D
): RestateWorkflow<D> {
  // Implemented untyped: `implement` can't resolve handler types for a generic D.
  const service = implement(workflowInterface(def.id), {
    handlers: { run: (ctx, input) => runHandler(def, ctx, input) },
  });
  return service as unknown as RestateWorkflow<D>;
}

const workflowSupport: RestateWorkflowSupport = implement(
  workflowSupportInterface,
  { handlers: { signal: signalHandler, approve: approveHandler } }
);

/**
 * The Restate services to mount for the given TanStack workflows: one service
 * per workflow (named after its id, with a `run` handler), followed by the
 * well-known `TanstackWorkflowSupport` service delivering signals and approvals.
 *
 * Each workflow service doubles as the interface for clients.
 *
 * @example
 * ```ts
 * restate.serve({ services: restateWorkflows(checkout, onboarding) });
 * ```
 */
export function restateWorkflows<const D extends AnyWorkflowDefinition[]>(
  ...defs: D
): [...{ [K in keyof D]: RestateWorkflow<D[K]> }, RestateWorkflowSupport] {
  return [...defs.map(restateWorkflow), workflowSupport] as [
    ...{ [K in keyof D]: RestateWorkflow<D[K]> },
    RestateWorkflowSupport,
  ];
}
