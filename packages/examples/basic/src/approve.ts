// Usage: pnpm approve <runId> [reject]
import { createRestateWorkflowRuntime } from "@restatedev/tanstack-workflows-client";

const runtime = createRestateWorkflowRuntime({
  url: process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080",
});

const [runId, reject] = process.argv.slice(2);
if (!runId) throw new Error("usage: pnpm approve <runId> [reject]");

const { kind } = await runtime.deliverApproval({
  workflowId: "checkout",
  runId,
  // The id the checkout workflow passes to `ctx.approve`.
  approval: { approvalId: "manager", approved: reject !== "reject" },
});
console.log(
  `${kind}: ${reject === "reject" ? "rejected" : "approved"} ${runId}`
);
