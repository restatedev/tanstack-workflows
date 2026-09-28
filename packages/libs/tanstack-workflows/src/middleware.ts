// Small, engine-agnostic helpers ported from `@tanstack/workflow-core`'s
// internal `run-workflow.ts` (composeMiddlewares + Standard Schema validation).
// These are pure and have no dependency on the TanStack replay engine, so we
// reuse them verbatim while driving the handler on Restate instead.

import { TerminalError } from "@restatedev/restate-sdk";
import type {
  AnyMiddleware,
  AnyWorkflowDefinition,
  Ctx,
  SchemaInput,
} from "@tanstack/workflow-core";

const reservedCtxFields = new Set([
  "runId",
  "input",
  "state",
  "signal",
  "runtime",
  "step",
  "sleep",
  "sleepUntil",
  "waitForEvent",
  "approve",
  "now",
  "uuid",
  "emit",
]);

/**
 * Thread the middleware chain over a shared, mutable `ctx` object, then call
 * the handler. Ported from `run-workflow.ts:composeMiddlewares`. Each middleware
 * merges its `next({ context })` extension into the same `ctx` reference, so
 * downstream middleware and the handler observe the additions.
 */
export function composeMiddlewares(
  middlewares: ReadonlyArray<AnyMiddleware>,
  ctx: Ctx<any, any, any>,
  handler: (ctx: Ctx<any, any, any>) => Promise<unknown>
): Promise<unknown> {
  const compose = async (index: number): Promise<unknown> => {
    if (index >= middlewares.length) return handler(ctx);
    const m = middlewares[index]!;
    let returned: unknown;
    let advanced = false;
    await m.server({
      ctx,
      next: async (opts) => {
        if (advanced) {
          throw new Error(
            "middleware.next() must be called at most once per invocation"
          );
        }
        advanced = true;
        const ext = opts.context;
        if (ext && typeof ext === "object") {
          for (const key of Object.keys(ext)) {
            if (reservedCtxFields.has(key)) {
              throw new Error(
                `Middleware extension may not shadow reserved ctx field: ${key}`
              );
            }
          }
          Object.assign(ctx, ext);
        }
        returned = await compose(index + 1);
        return returned;
      },
    });
    return returned;
  };
  return compose(0);
}

// Validation is deterministic, so failures are terminal: retrying cannot help.
function validateSyncSchema(
  schema: SchemaInput,
  value: unknown,
  label: string
): unknown {
  const result = (schema as any)["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new TerminalError(
      `${label}: async schema validation is not supported in a durable step boundary`
    );
  }
  if (result.issues) {
    const messages = result.issues
      .map((i: { message: string }) => i.message)
      .join(", ");
    throw new TerminalError(`${label} validation failed: ${messages}`);
  }
  return result.value;
}

export function validateWorkflowInput(
  def: AnyWorkflowDefinition,
  input: unknown
): unknown {
  if (!def.inputSchema) return input;
  return validateSyncSchema(
    def.inputSchema,
    input,
    `Workflow "${def.id}" input`
  );
}

export function validateWorkflowOutput(
  def: AnyWorkflowDefinition,
  output: unknown
): unknown {
  if (!def.outputSchema) return output;
  return validateSyncSchema(
    def.outputSchema,
    output,
    `Workflow "${def.id}" output`
  );
}

export function validateStandard(
  schema: SchemaInput,
  value: unknown,
  label: string
): unknown {
  return validateSyncSchema(schema, value, label);
}

export function buildInitialState(
  def: AnyWorkflowDefinition,
  input: unknown
): Record<string, unknown> {
  const initial: Record<string, unknown> = def.initialize
    ? def.initialize({ input: input as never })
    : {};
  if (!def.stateSchema) return initial;
  return validateSyncSchema(
    def.stateSchema,
    initial,
    `Workflow "${def.id}" initial state`
  ) as Record<string, unknown>;
}
