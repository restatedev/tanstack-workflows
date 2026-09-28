// The README `checkout` workflow, authored with the *unmodified* TanStack
// authoring API. Nothing here knows it runs on Restate — proving the authoring
// surface is reused verbatim while the runtime is swapped underneath.

import { createWorkflow } from "@tanstack/workflow-core";
import { z } from "zod";

// Stand-ins for real side effects. Under Restate these run inside `ctx.step`
// (→ `ctx.run`), so their results are journaled and never re-executed on replay.
const stripe = {
  charges: {
    create: async (
      args: { customer: string; amount: number },
      opts: { idempotencyKey: string }
    ) => {
      console.log(
        `charging ${args.amount} for ${args.customer} (idempotencyKey=${opts.idempotencyKey})`
      );
      return { id: `ch_${Math.random().toString(36).slice(2, 10)}` };
    },
  },
};

async function sendReceipt(chargeId: string) {
  console.log(`sending receipt for ${chargeId}`);
}

export const checkout = createWorkflow({
  id: "checkout",
  input: z.object({ userId: z.string(), amount: z.number() }),
  output: z.object({ status: z.enum(["approved", "rejected"]) }),
}).handler(async (ctx) => {
  const charge = await ctx.step("charge-card", (stepCtx) =>
    stripe.charges.create(
      { customer: ctx.input.userId, amount: ctx.input.amount },
      { idempotencyKey: stepCtx.id }
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
