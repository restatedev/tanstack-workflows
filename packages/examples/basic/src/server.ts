// Restate service endpoint hosting the checkout workflow.
// Register with: `npx @restatedev/restate deployments register http://localhost:9080`.
import * as restate from "@restatedev/restate-sdk";
import { restateWorkflows } from "@restatedev/tanstack-workflows";
import { checkout } from "./checkout.js";

restate.serve({ services: restateWorkflows(checkout) });
