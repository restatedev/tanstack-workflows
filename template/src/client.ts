// Usage:
//   npm run client start <runId> <amount>
//   npm run client approve <runId>
//   npm run client reject <runId>
//   npm run client status <runId>
//   npm run client result <runId>
import { createRestateWorkflowRuntime } from "@restatedev/tanstack-workflows-client";

const runtime = createRestateWorkflowRuntime({
  url: process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080",
});

const [command, runId, amount = "4200"] = process.argv.slice(2);
if (!runId) throw new Error("usage: npm run client <command> <runId>");

switch (command) {
  case "start":
    console.log(
      await runtime.startRun({
        workflowId: "checkout",
        runId,
        input: { userId: "cus_123", amount: Number(amount) },
      })
    );
    break;
  case "approve":
  case "reject":
    console.log(
      await runtime.deliverApproval({
        workflowId: "checkout",
        runId,
        approval: { approvalId: "manager", approved: command === "approve" },
      })
    );
    break;
  case "status":
    console.log(await runtime.getRun("checkout", runId));
    break;
  case "result":
    console.log(await runtime.attachRun("checkout", runId));
    break;
  default:
    throw new Error(`unknown command: ${command}`);
}
