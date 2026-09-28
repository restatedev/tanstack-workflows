# TanStack Workflows on Restate: template

A ready-to-copy project with a TanStack workflow served by Restate, and a client
to start runs and approve them.

```bash
npx degit restatedev/tanstack-workflows/template my-workflows
cd my-workflows
npm install
```

## Run it

```bash
# 1. Start Restate
docker run --name restate_dev --rm --network=host docker.restate.dev/restatedev/restate:latest

# 2. Start the workflow server (restarts on changes)
npm run dev

# 3. Register it with Restate
npx @restatedev/restate deployments register http://localhost:9080

# 4. Start a run that needs approval, then approve it
npm run client start order-1 20000
npm run client status order-1
npm run client approve order-1
npm run client result order-1
```

Runs up to `10000` complete right away: `npm run client start order-2 4200`.

## What's where

- `src/workflows.ts`: the workflow, plain `@tanstack/workflow-core`.
- `src/server.ts`: serves it with Restate via `restateWorkflows(...)`.
- `src/client.ts`: starts runs and delivers approvals via `createRestateWorkflowRuntime(...)`.

Open the Restate UI at http://localhost:9070 to inspect runs and their journals.
