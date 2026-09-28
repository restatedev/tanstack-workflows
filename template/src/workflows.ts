import { createWorkflow } from "@tanstack/workflow-core";
import { z } from "zod";

export const checkout = createWorkflow({
  id: "checkout",
  input: z.object({ userId: z.string(), amount: z.number() }),
  output: z.object({ status: z.enum(["approved", "rejected"]) }),
}).handler(async (ctx) => {
  // Steps are journaled by Restate: on retries and replays they don't run again.
  const charge = await ctx.step("charge-card", async (step) => {
    // Use `step.id` as idempotency key towards external systems.
    console.log(`charging ${ctx.input.amount} (idempotencyKey=${step.id})`);
    return { id: `ch_${await ctx.uuid()}` };
  });

  if (ctx.input.amount > 10_000) {
    // Blocks durably until someone calls `deliverApproval` with this id.
    const decision = await ctx.approve({
      id: "manager",
      title: "Approve large charge?",
    });
    if (!decision.approved) return { status: "rejected" as const };
  }

  await ctx.step("send-receipt", () => {
    console.log(`sending receipt for ${charge.id}`);
  });
  return { status: "approved" as const };
});
