import { createWorkflow } from "@tanstack/workflow-core";
import { z } from "zod";

export const steps = createWorkflow({
  id: "steps",
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string(), id: z.string() }),
}).handler(async (ctx) => {
  const id = await ctx.uuid();
  const greeting = await ctx.step("greet", () => `Hello, ${ctx.input.name}!`);
  await ctx.sleep(10);
  return { greeting, id };
});

export const approval = createWorkflow({
  id: "approval",
  input: z.object({ amount: z.number() }),
  output: z.object({ status: z.enum(["approved", "rejected"]) }),
}).handler(async (ctx) => {
  const decision = await ctx.approve({ id: "manager", title: "Approve?" });
  return { status: decision.approved ? "approved" : "rejected" } as const;
});

export const events = createWorkflow({
  id: "events",
  output: z.object({ received: z.string() }),
}).handler(async (ctx) => {
  const payload = await ctx.waitForEvent<{ value: string }>("ping");
  return { received: payload.value };
});

// Waits repeatedly on the same name (the first wait with an explicit id),
// collecting payloads until "done".
export const messages = createWorkflow({
  id: "messages",
  output: z.object({ received: z.array(z.string()) }),
}).handler(async (ctx) => {
  const received: string[] = [];
  let msg = await ctx.waitForEvent<string>("msg", { id: "first-msg" });
  while (msg !== "done") {
    received.push(msg);
    msg = await ctx.waitForEvent<string>("msg");
  }
  return { received };
});
