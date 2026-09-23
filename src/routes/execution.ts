import { Hono } from "hono";

import { readConfig } from "../config.js";
import { getHandler, getProcessDescription } from "../processes/registry.js";
import { getToggle } from "../processes/toggle.js";
import {
  normaliseIptRequest,
  wrapWithProvenance,
  type ProvenanceMode,
} from "../prov/emit.js";
import { createJob, storeJobResult } from "./jobs.js";

function parseProvenanceMode(raw: string | undefined): ProvenanceMode {
  return raw === "reference" ? "reference" : "inline";
}

export const executionRoute = new Hono();

executionRoute.post("/:id/execution", async (c) => {
  const cfg = readConfig();
  const id = c.req.param("id");
  const provMode = parseProvenanceMode(c.req.query("provenance"));

  const desc = getProcessDescription(id, cfg);
  if (!desc) {
    return c.json({ type: "NoSuchProcess", title: `Process '${id}' not found`, status: 404 }, 404);
  }

  const handler = getHandler(id);
  if (!handler) {
    return c.json({ type: "NotImplemented", title: `No handler wired for '${id}'`, status: 501 }, 501);
  }

  const toggle = getToggle(id);
  if (!toggle.enabled) {
    return c.json({ type: "ProcessDisabled", title: `Process '${id}' is disabled by toggle`, status: 503 }, 503);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ type: "InvalidParameterValue", title: "Body is not valid JSON", status: 400 }, 400);
  }

  const normalised = normaliseIptRequest(body, id, cfg, toggle);
  if ("error" in normalised) {
    return c.json({ type: "InvalidParameterValue", title: normalised.error, status: 400 }, 400);
  }

  const prefer = c.req.header("Prefer") ?? "";
  const isAsync = /respond-async/i.test(prefer);

  if (isAsync) {
    const job = createJob(id, normalised);
    // Kick off handler in the background — result stored when it resolves.
    (async () => {
      try {
        const outputs = await handler(normalised, cfg);
        const wrapped = wrapWithProvenance(outputs, normalised, {
          mode: provMode,
          publicBaseUrl: cfg.publicBaseUrl,
        });
        storeJobResult(job.jobID, { status: "successful", outputs: wrapped });
      } catch (err) {
        storeJobResult(job.jobID, {
          status: "failed",
          error: (err as Error).message ?? String(err),
        });
      }
    })();
    return c.json(job, 201, { Location: `${cfg.publicBaseUrl}/jobs/${job.jobID}` });
  }

  try {
    const outputs = await handler(normalised, cfg);
    const wrapped = wrapWithProvenance(outputs, normalised, {
      mode: provMode,
      publicBaseUrl: cfg.publicBaseUrl,
    });
    return c.json({ outputs: wrapped }, 200);
  } catch (err) {
    return c.json(
      {
        type: "NoApplicableCode",
        title: (err as Error).message ?? String(err),
        status: 500,
      },
      500
    );
  }
});
