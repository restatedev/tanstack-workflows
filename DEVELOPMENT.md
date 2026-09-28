# Development

## Layout

| Path                                       | What                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `packages/libs/tanstack-workflows`         | Server adapter: `restateWorkflows(...)`                              |
| `packages/libs/tanstack-workflows-interface` | Restate `iface` contracts, only depends on `@restatedev/restate-sdk-core` |
| `packages/libs/tanstack-workflows-client`  | `createRestateWorkflowRuntime(...)`                                  |
| `packages/examples/basic`                  | Runnable checkout example                                            |
| `packages/tests/integration`               | Integration tests against a real Restate (testcontainers)            |

## Setup

Requires Node >= 22, pnpm 10, and Docker (or Podman) for the integration tests,
which run against the Restate nightly image (`ghcr.io/restatedev/restate:main`,
override with `RESTATE_IMAGE`).

```bash
pnpm install
pnpm test          # unit + integration tests (starts Restate in a container)
pnpm test:watch
pnpm example       # run the example service with watch mode
pnpm verify        # everything CI runs: format, lint, types, build, exports, tests
```

No build step is needed during development: workspace packages resolve each
other's `src/` via the `@restatedev/source` export condition (wired into
`tsconfig`, vitest and tsx). `pnpm build` only matters for publishing.

Tooling: TypeScript 7, tsdown (ESM + CJS + d.ts), vitest, oxlint, prettier,
attw (checks published exports).

## Running the example

```bash
# 1. Start Restate
npx @restatedev/restate-server

# 2. Start the service
pnpm example

# 3. Register it
npx @restatedev/restate deployments register http://localhost:9080

# 4. Start runs and approve them
pnpm --filter @restatedev/tanstack-workflows-example client run1 4200
pnpm --filter @restatedev/tanstack-workflows-example client run2 20000   # blocks on approval
pnpm --filter @restatedev/tanstack-workflows-example approve run2
```

## Release

All libs share one version.

```bash
pnpm release 0.1.0
```

This bumps the libs to `0.1.0`, runs `pnpm verify`, commits, tags `v0.1.0` and
pushes. The tag triggers [`publish.yml`](./.github/workflows/publish.yml), which
publishes to npm and creates a GitHub release. Requires the `NPM_TOKEN` repo secret.
