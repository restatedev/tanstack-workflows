# @restatedev/tanstack-workflows

Run [TanStack workflows](https://github.com/TanStack/workflow) on [Restate](https://restate.dev).

```bash
npm install @restatedev/tanstack-workflows @restatedev/restate-sdk @tanstack/workflow-core
```

```ts
import * as restate from "@restatedev/restate-sdk";
import { restateWorkflows } from "@restatedev/tanstack-workflows";
import { checkout, onboarding } from "./workflows.js";

await restate.serve({ services: restateWorkflows(checkout, onboarding), port: 9080 });
```

Start runs and deliver signals/approvals with
[`@restatedev/tanstack-workflows-client`](https://www.npmjs.com/package/@restatedev/tanstack-workflows-client).

Full docs: https://github.com/restatedev/tanstack-workflows
