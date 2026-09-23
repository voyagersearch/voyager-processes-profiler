import { Hono } from "hono";

export const conformanceRoute = new Hono();

conformanceRoute.get("/", (c) => {
  return c.json({
    conformsTo: [
      "http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/core",
      "http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/ogc-process-description",
      "http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/json",
      "http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/oas30",
      "https://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/callback",
      "https://ogcincubator.github.io/bblocks-openscience/bblock/ogc.osc.api-profiles.processes.ipt.api",
      "https://ogcincubator.github.io/bblocks-openscience/bblock/ogc.osc.api-profiles.processes.workflow",
    ],
  });
});
