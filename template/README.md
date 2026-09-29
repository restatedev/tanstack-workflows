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
docker run --name restate --network=host docker.restate.dev/restatedev/restate:latest

# 2. Start the workflow server
npm run dev

# 3. Register it with Restate
npx @restatedev/restate deployments register http://localhost:9080

# 4. Start a run that needs approval, then approve it
npm run client start order-1 20000
npm run client status order-1
npm run client approve order-1
npm run client result order-1
```

## Test it

```bash
npm test
```

This starts Restate in Docker with Testcontainers, serves the workflow and runs
it end to end. It only needs Docker running.

## What's where

- `src/workflows.ts`: the workflow, plain `@tanstack/workflow-core`.
- `src/server.ts`: serves it with Restate via `restateWorkflows(...)`.
- `src/client.ts`: starts runs and delivers approvals via `createRestateWorkflowRuntime(...)`.
- `src/workflows.test.ts`: end-to-end test against a real Restate.

Open the Restate UI at http://localhost:9070 to inspect runs and their journals.
