# TanStack Workflows on Restate

Run your [TanStack workflows](https://github.com/TanStack/workflow) on [Restate](https://restate.dev).

```bash
npm install @restatedev/tanstack-workflows @restatedev/restate-sdk @tanstack/workflow-core
```

## 1. Write a workflow

A plain TanStack workflow:

```ts
// checkout.ts
import { createWorkflow } from "@tanstack/workflow-core";
import { z } from "zod";

export const checkout = createWorkflow({
  id: "checkout",
  input: z.object({ userId: z.string(), amount: z.number() }),
  output: z.object({ status: z.enum(["approved", "rejected"]) }),
}).handler(async (ctx) => {
  const charge = await ctx.step("charge-card", (step) =>
    stripe.charges.create(
      { customer: ctx.input.userId, amount: ctx.input.amount },
      { idempotencyKey: step.id }
    )
  );

  if (ctx.input.amount > 10_000) {
    const decision = await ctx.approve({
      id: "manager",
      title: "Approve large charge?",
    });
    if (!decision.approved) return { status: "rejected" as const };
  }

  await ctx.step("send-receipt", () => sendReceipt(charge.id));
  return { status: "approved" as const };
});
```

## 2. Serve it with Restate

```ts
// server.ts
import * as restate from "@restatedev/restate-sdk";
import { restateWorkflows } from "@restatedev/tanstack-workflows";
import { checkout } from "./checkout.js";

await restate.serve({ services: restateWorkflows(checkout), port: 9080 });
```

Start Restate and register your service:

```bash
npx @restatedev/restate-server
npx @restatedev/restate deployments register http://localhost:9080
```

## 3. Start runs, send approvals and signals

```bash
npm install @restatedev/tanstack-workflows-client @restatedev/restate-sdk-clients
```

```ts
import { createRestateWorkflowRuntime } from "@restatedev/tanstack-workflows-client";

const runtime = createRestateWorkflowRuntime({ url: "http://localhost:8080" });

// Start a run. `runId` is the idempotency key: starting it twice is a no-op.
await runtime.startRun({
  workflowId: "checkout",
  runId: "order-42",
  input: { userId: "cus_123", amount: 20_000 },
});

// Later, from anywhere (a webhook, an admin UI, ...):
await runtime.deliverApproval({
  workflowId: "checkout",
  runId: "order-42",
  approval: { approvalId: "manager", approved: true },
});

// Wait for the result...
const output = await runtime.attachRun("checkout", "order-42");
// ...or just check on it.
const run = await runtime.getRun("checkout", "order-42");
// { runId, workflowId, status: "queued" | "running" | "finished" | "errored", output?, error? }
```

Signals work the same way, resolving `ctx.waitForEvent(name)`:

```ts
await runtime.deliverSignal({
  workflowId: "checkout",
  runId: "order-42",
  signalId: "evt-1",
  name: "payment-confirmed",
  payload: { paymentId: "pay_1" },
});
```

## How it maps

| TanStack `ctx`            | On Restate                                                        |
|---------------------------|-------------------------------------------------------------------|
| `step(id, fn, { retry })` | `ctx.run`: journaled, retried, never re-executed on replay        |
| `sleep` / `sleepUntil`    | Durable Restate timer                                             |
| `waitForEvent(name)`      | Restate signal; early deliveries are buffered until the run waits |
| `approve({ id, ... })`    | Restate signal, resolved by `deliverApproval` with that `id`      |
| `now()` / `uuid()`        | Deterministic `ctx.date.now()` / `ctx.rand.uuidv4()`              |
| `runId`                   | Idempotency key of the run                                        |

Each workflow becomes a Restate service named after its `id`, plus one shared
`TanstackWorkflowSupport` service that delivers signals and approvals.

You get Restate's UI, tracing and journal introspection for free.

## Contributing

See [DEVELOPMENT.md](./DEVELOPMENT.md).

## License

[MIT](./LICENSE)
