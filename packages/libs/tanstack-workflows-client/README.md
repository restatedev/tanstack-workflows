# @restatedev/tanstack-workflows-client

Start and drive [TanStack workflows](https://github.com/TanStack/workflow) running on
[Restate](https://restate.dev) with
[`@restatedev/tanstack-workflows`](https://www.npmjs.com/package/@restatedev/tanstack-workflows).

```bash
npm install @restatedev/tanstack-workflows-client @restatedev/restate-sdk-clients
```

```ts
import { createRestateWorkflowRuntime } from "@restatedev/tanstack-workflows-client";

const runtime = createRestateWorkflowRuntime({ url: "http://localhost:8080" });

await runtime.startRun({ workflowId: "checkout", runId: "order-42", input: { amount: 20_000 } });
await runtime.deliverApproval({
  workflowId: "checkout",
  runId: "order-42",
  approval: { approvalId: "manager", approved: true },
});
const output = await runtime.attachRun("checkout", "order-42");
```

Full docs: https://github.com/restatedev/tanstack-workflows
