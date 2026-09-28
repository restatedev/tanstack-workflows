# Example

Standalone example using `@restatedev/tanstack-workflows` and `@restatedev/tanstack-workflows-client`.

## Run it

```bash
# 1. Start Restate (>= 1.8)
npx @restatedev/restate-server

# 2. Start the service (from the repo root: `pnpm example`)
pnpm dev

# 3. Register the service with Restate
npx @restatedev/restate deployments register http://localhost:9080

# 4. Happy path (amount <= 10000)
pnpm client run1 4200

# 5. Approval path: blocks until approved from another shell
pnpm client run2 20000
pnpm approve run2          # or: pnpm approve run2 reject
```

## Copying this example out of the monorepo

Replace the `workspace:^` versions in `package.json` with the published versions
(e.g. `"@restatedev/tanstack-workflows": "^0.1.0"`), then `npm install`.
