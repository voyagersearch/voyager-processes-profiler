import { Hono } from "hono";

import { readConfig } from "../config.js";
import { getEnabledProcesses, getProcessDescription } from "../processes/registry.js";

export const processesRoute = new Hono();

processesRoute.get("/", (c) => {
  const cfg = readConfig();
  const enabled = getEnabledProcesses();
  return c.json({
    processes: enabled.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      version: p.version,
      jobControlOptions: ["sync-execute", "async-execute"],
      outputTransmission: ["value"],
      links: [
        { href: `${cfg.publicBaseUrl}/processes/${p.id}`, rel: "self", type: "application/json", title: "Process description" },
        { href: `${cfg.publicBaseUrl}/processes/${p.id}/execution`, rel: "http://www.opengis.net/def/rel/ogc/1.0/execute", type: "application/json", title: "Execute endpoint" },
        ...(cfg.registerBaseUrl
          ? [{ href: `${cfg.registerBaseUrl}/activities/${p.id}`, rel: "http://www.opengis.net/def/rel/ogc/1.0/definition", type: "application/json", title: "Register definition" }]
          : []),
      ],
    })),
    links: [
      { href: `${cfg.publicBaseUrl}/processes`, rel: "self", type: "application/json" },
    ],
  });
});

processesRoute.get("/:id", (c) => {
  const cfg = readConfig();
  const id = c.req.param("id");
  const desc = getProcessDescription(id, cfg);
  if (!desc) {
    return c.json({ type: "NoSuchProcess", title: `Process '${id}' not found`, status: 404 }, 404);
  }
  return c.json(desc);
});
