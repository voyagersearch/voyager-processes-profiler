import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { readConfig } from "./config.js";
import { landingRoute } from "./routes/landing.js";
import { conformanceRoute } from "./routes/conformance.js";
import { processesRoute } from "./routes/processes.js";
import { executionRoute } from "./routes/execution.js";
import { jobsRoute } from "./routes/jobs.js";
import { openapiRoute } from "./routes/openapi.js";
import { provRoute } from "./routes/prov.js";

const app = new Hono();

app.route("/", landingRoute);
app.route("/conformance", conformanceRoute);
app.route("/processes", processesRoute);
app.route("/processes", executionRoute);
app.route("/jobs", jobsRoute);
app.route("/openapi", openapiRoute);
app.route("/prov", provRoute);

const cfg = readConfig();
serve({ fetch: app.fetch, port: cfg.port }, ({ port }) => {
  console.error(`[voyager-processes-profiler] listening on http://localhost:${port}`);
  console.error(`[voyager-processes-profiler] public base ${cfg.publicBaseUrl}`);
});
