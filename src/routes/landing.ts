import { Hono } from "hono";

import { readConfig } from "../config.js";

export const landingRoute = new Hono();

landingRoute.get("/", (c) => {
  const cfg = readConfig();
  return c.json({
    title: "Voyager Processes Profiler",
    description:
      "OGC API-Processes 1.0 with the OSC IPT (Integrity, Provenance, Trust) profile applied. OSPD D120.",
    links: [
      { href: `${cfg.publicBaseUrl}/`, rel: "self", type: "application/json", title: "This document" },
      { href: `${cfg.publicBaseUrl}/conformance`, rel: "conformance", type: "application/json", title: "Conformance classes" },
      { href: `${cfg.publicBaseUrl}/processes`, rel: "processes", type: "application/json", title: "Processes" },
      { href: `${cfg.publicBaseUrl}/openapi`, rel: "service-desc", type: "application/vnd.oai.openapi;version=3.1", title: "OpenAPI 3.1 description" },
      { href: "https://docs.ogc.org/is/18-062r2/18-062r2.html", rel: "describedby", type: "text/html", title: "OGC API - Processes 1.0" },
      { href: "https://github.com/ogcincubator/bblocks-openscience/tree/master/_sources/api-profiles/processes/ipt", rel: "profile", type: "text/html", title: "OSC IPT profile bblock" },
    ],
  });
});
