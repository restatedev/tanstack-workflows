import * as restate from "@restatedev/restate-sdk";
import { restateWorkflows } from "@restatedev/tanstack-workflows";
import { checkout } from "./workflows.js";

restate.serve({
  services: restateWorkflows(checkout),
});
