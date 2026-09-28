# @restatedev/tanstack-workflows-interface

Restate service contracts of workflows served with
[`@restatedev/tanstack-workflows`](https://www.npmjs.com/package/@restatedev/tanstack-workflows).
Only depends on `@restatedev/restate-sdk-core`, so it's safe to use from any client,
e.g. to call a workflow service directly with a Restate ingress client or from another
Restate service.

```ts
import { workflowInterface } from "@restatedev/tanstack-workflows-interface";

const checkout = workflowInterface<CheckoutInput, CheckoutOutput>("checkout");
```

Most apps want [`@restatedev/tanstack-workflows-client`](https://www.npmjs.com/package/@restatedev/tanstack-workflows-client) instead.

Full docs: https://github.com/restatedev/tanstack-workflows
