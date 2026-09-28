// Usage: pnpm client <runId> <amount>
import { createRestateWorkflowRuntime } from "@restatedev/tanstack-workflows-client";

const runtime = createRestateWorkflowRuntime({
  url: process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080",
});

const [runId = `run-${Date.now()}`, amount = "4200"] = process.argv.slice(2);

const { kind } = await runtime.startRun({
  workflowId: "checkout",
  runId,
  input: { userId: "cus_123", amount: Number(amount) },
});
console.log(`${kind} ${runId}, waiting for it to finish...`);
console.log(
  await runtime.attachRun<{ status: "approved" | "rejected" }>(
    "checkout",
    runId
  )
);
