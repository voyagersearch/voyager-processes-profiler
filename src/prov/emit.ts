import { randomUUID } from "node:crypto";

import type { Config } from "../config.js";
import type { ProcessToggle } from "../processes/toggle.js";

export interface IptRequest {
  activity_id?: string;
  agent_id?: string;
  result_id?: string;
  inputs?: Record<string, unknown>;
  outputs?: unknown;
  subscriber?: unknown;
}

export interface NormalisedIptRequest {
  activity_id: string;
  agent_id: string;
  result_id: string;
  process_id: string;
  started_at: string;
  inputs: Record<string, unknown>;
  clientProvided: {
    activity_id: boolean;
    agent_id: boolean;
    result_id: boolean;
  };
}

export function normaliseIptRequest(
  body: unknown,
  processId: string,
  cfg: Config,
  toggle: ProcessToggle
): NormalisedIptRequest | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object" };
  }
  const b = body as IptRequest;
  const startedAt = new Date().toISOString();
  const runId = randomUUID();

  const clientProvided = {
    activity_id: typeof b.activity_id === "string" && b.activity_id.length > 0,
    agent_id: typeof b.agent_id === "string" && b.agent_id.length > 0,
    result_id: typeof b.result_id === "string" && b.result_id.length > 0,
  };

  if (toggle.iptCompliance === "strict") {
    if (!clientProvided.activity_id) {
      return { error: "IPT strict mode: 'activity_id' is required" };
    }
    if (!clientProvided.agent_id) {
      return { error: "IPT strict mode: 'agent_id' is required" };
    }
    if (!clientProvided.result_id) {
      return { error: "IPT strict mode: 'result_id' is required" };
    }
  }

  // Permissive: mint any missing IRI so downstream PROV emission is stable.
  const activity_id = clientProvided.activity_id
    ? (b.activity_id as string)
    : `${cfg.publicBaseUrl}/prov/activity/${runId}`;
  const agent_id = clientProvided.agent_id
    ? (b.agent_id as string)
    : `${cfg.publicBaseUrl}/prov/agent/${processId}/v0.1`;
  const result_id = clientProvided.result_id
    ? (b.result_id as string)
    : `${cfg.publicBaseUrl}/prov/entity/${runId}`;

  const inputs =
    b.inputs && typeof b.inputs === "object" && !Array.isArray(b.inputs)
      ? (b.inputs as Record<string, unknown>)
      : {};

  return {
    activity_id,
    agent_id,
    result_id,
    process_id: processId,
    started_at: startedAt,
    inputs,
    clientProvided,
  };
}

/**
 * Wrap raw handler outputs with an inline PROV block conforming to
 * `ogc.osc.api-profiles.processes.ipt.results` — i.e. an outputs envelope
 * whose value carries the prov:Activity that produced it, using the IRIs
 * the client nominated (or that we minted).
 *
 * The client can drop the `provenance` object into any PROV-aware store as
 * a `prov:Activity` record. The chain the handler emitted to HQ (via the
 * separate sink) is where the fuller graph lives.
 */
export function wrapWithProvenance(
  outputs: Record<string, unknown>,
  req: NormalisedIptRequest
): Record<string, unknown> {
  const endedAt = new Date().toISOString();
  return {
    ...outputs,
    provenance: {
      "@context": "https://www.w3.org/ns/prov",
      "@type": "prov:Activity",
      "@id": req.activity_id,
      "prov:type": req.process_id,
      "prov:startedAtTime": req.started_at,
      "prov:endedAtTime": endedAt,
      "prov:wasAssociatedWith": { "@id": req.agent_id },
      "prov:generated": { "@id": req.result_id },
    },
  };
}
