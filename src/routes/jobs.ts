import { Hono } from "hono";
import { randomUUID } from "node:crypto";

import { readConfig } from "../config.js";
import type { NormalisedIptRequest } from "../prov/emit.js";

export interface JobRecord {
  jobID: string;
  processID: string;
  status: "accepted" | "running" | "successful" | "failed" | "dismissed";
  created: string;
  finished?: string;
  request: NormalisedIptRequest;
  outputs?: unknown;
  error?: string;
}

// In-memory job store — fine for the standalone demo. Persistent job stores
// are a 27.1 concern; the store is behind these two helpers so we can swap it.
const jobs = new Map<string, JobRecord>();

export function createJob(processID: string, request: NormalisedIptRequest): JobRecord {
  const jobID = randomUUID();
  const record: JobRecord = {
    jobID,
    processID,
    status: "accepted",
    created: new Date().toISOString(),
    request,
  };
  jobs.set(jobID, record);
  return record;
}

export function storeJobResult(
  jobID: string,
  outcome: { status: "successful"; outputs: unknown } | { status: "failed"; error: string }
): void {
  const rec = jobs.get(jobID);
  if (!rec) return;
  rec.status = outcome.status;
  rec.finished = new Date().toISOString();
  if (outcome.status === "successful") rec.outputs = outcome.outputs;
  else rec.error = outcome.error;
}

export const jobsRoute = new Hono();

jobsRoute.get("/:jobId", (c) => {
  const cfg = readConfig();
  const rec = jobs.get(c.req.param("jobId"));
  if (!rec) return c.json({ type: "NoSuchJob", status: 404 }, 404);
  return c.json({
    jobID: rec.jobID,
    processID: rec.processID,
    status: rec.status,
    created: rec.created,
    finished: rec.finished,
    links: [
      { href: `${cfg.publicBaseUrl}/jobs/${rec.jobID}`, rel: "self", type: "application/json" },
      { href: `${cfg.publicBaseUrl}/jobs/${rec.jobID}/results`, rel: "http://www.opengis.net/def/rel/ogc/1.0/results", type: "application/json" },
    ],
  });
});

jobsRoute.get("/:jobId/results", (c) => {
  const rec = jobs.get(c.req.param("jobId"));
  if (!rec) return c.json({ type: "NoSuchJob", status: 404 }, 404);
  if (rec.status === "failed") return c.json({ type: "JobFailed", detail: rec.error, status: 500 }, 500);
  if (rec.status !== "successful") return c.json({ type: "ResultNotReady", status: 404 }, 404);
  return c.json(rec.outputs);
});
