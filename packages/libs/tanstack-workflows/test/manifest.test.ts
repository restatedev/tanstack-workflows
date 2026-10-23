import { describe, expect, it } from "vitest";
import { createEndpointHandler } from "@restatedev/restate-sdk/fetch";
import { createWorkflow } from "@tanstack/workflow-core";
import { z } from "zod";
import { restateWorkflows } from "../src/index.js";
import pkg from "../package.json" with { type: "json" };
import { checkout } from "./checkout.js";

type Manifest = {
  services: Array<{
    name: string;
    metadata?: Record<string, string>;
    handlers: Array<{
      name: string;
      input?: { jsonSchema?: object };
      output?: { jsonSchema?: object };
    }>;
  }>;
};

async function discover(
  services: ReturnType<typeof restateWorkflows>
): Promise<Manifest> {
  const handler = createEndpointHandler({ services });
  const res = await handler(
    new Request("http://localhost/discover", {
      headers: { accept: "application/vnd.restate.endpointmanifest.v4+json" },
    })
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Manifest;
}

const service = (manifest: Manifest, name: string) => {
  const s = manifest.services.find((s) => s.name === name);
  if (!s) throw new Error(`no service ${name}`);
  return s;
};

const handler = (manifest: Manifest, name: string, handlerName: string) => {
  const h = service(manifest, name).handlers.find(
    (h) => h.name === handlerName
  );
  if (!h) throw new Error(`no handler ${name}/${handlerName}`);
  return h;
};

// A Standard Schema without the JSON Schema extension.
const opaque = {
  "~standard": {
    version: 1 as const,
    vendor: "test",
    validate: (value: unknown) => ({ value }),
  },
};

const unconvertible = createWorkflow({
  id: "unconvertible",
  input: opaque,
  // Dates have no JSON Schema: zod's converter throws.
  output: z.object({ at: z.date() }),
}).handler(async () => ({ at: new Date() }));

const untyped = createWorkflow({ id: "untyped" }).handler(async () => "ok");

describe("discovery manifest", () => {
  it("has exactly one service per workflow", async () => {
    const manifest = await discover(restateWorkflows(checkout, untyped));
    expect(manifest.services.map((s) => s.name).sort()).toEqual([
      "checkout",
      "untyped",
    ]);
    for (const s of manifest.services) {
      expect(s.handlers.map((h) => h.name).sort()).toEqual([
        "approve",
        "run",
        "signal",
      ]);
    }
  });

  it("marks each workflow service as a TanStack workflow", async () => {
    const manifest = await discover(restateWorkflows(checkout, untyped));
    for (const name of ["checkout", "untyped"]) {
      expect(service(manifest, name).metadata).toEqual({
        "restate.dev/integration": "tanstack-workflow",
        "restate.dev/integration-version": pkg.version,
      });
    }
  });

  it("carries the definition's schemas on run", async () => {
    const run = handler(
      await discover(restateWorkflows(checkout)),
      "checkout",
      "run"
    );
    expect(run.input?.jsonSchema).toEqual(
      z
        .object({ userId: z.string(), amount: z.number() })
        .toJSONSchema({ io: "input" })
    );
    expect(run.input?.jsonSchema).toMatchObject({
      type: "object",
      properties: { userId: { type: "string" }, amount: { type: "number" } },
      required: ["userId", "amount"],
    });
    expect(run.output?.jsonSchema).toMatchObject({
      type: "object",
      properties: { status: { enum: ["approved", "rejected"] } },
    });
  });

  it("omits schemas that can't be converted", async () => {
    const manifest = await discover(restateWorkflows(unconvertible, untyped));
    for (const name of ["unconvertible", "untyped"]) {
      const run = handler(manifest, name, "run");
      expect(run.input?.jsonSchema).toBeUndefined();
      expect(run.output?.jsonSchema).toBeUndefined();
    }
  });
});
