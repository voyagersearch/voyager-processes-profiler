/**
 * Fire-and-forget sidecar writer. Called from src/routes/execution.ts after
 * every successful process execution. Each write produces one JSON sidecar
 * under {HQ_PROV_FILE_ROOT}/{HQ_PROV_SUBPATH}/{shard}/{slug}.json that the
 * PROV Records folder repo (r1a02cbdfdbe on demo HQ) sweeps into Solr `main`.
 *
 * Once landed, D120-emitted runs become discoverable via the same Solr queries
 * the RAG service uses — closing the loop with the D110 register at the
 * discoverability layer.
 *
 * The writer builds a SolrProvDoc-shaped payload directly instead of routing
 * through voyager-prov-ts's emit(): that helper hashes activity URNs from the
 * request contents to deterministically dedupe emissions, but D120 already
 * has the IPT-nominated activity_id / result_id / agent_id — no derivation
 * needed. Passing them through gives the sidecar the same IRIs the client saw.
 *
 * Non-throwing: sidecar failure MUST NOT fail the request. HQ availability is
 * ops-controlled and orthogonal to whether D120 successfully served the caller.
 */

import type { Config } from "../config.js";
import type { NormalisedIptRequest } from "./emit.js";
import { activityTypeUri } from "./register-map.js";
import { putSidecar } from "./sink.js";
import type { StoredProvActivity } from "./store.js";

interface SolrProvDoc {
  id: string;
  prov_id: string;
  prov_activityType: string;
  prov_agent: string;
  prov_used: string[];
  prov_generated: string[];
  prov_startedAt: string;
  prov_endedAt: string;
  prov_jsonld: string;
}

/**
 * Extract input-entity URIs from the normalised request. For v0.2 handlers
 * we don't yet demand structured input-URI declarations from callers — most
 * handlers take opaque `query` / `top_k` values. Any input value that LOOKS
 * like an IRI (http, https, or urn: prefix) gets promoted into prov_used.
 * The rest are dropped from the graph but preserved in prov_jsonld's `extra`.
 */
function extractUsedURIs(inputs: Record<string, unknown>): {
  used: string[];
  extra: Record<string, unknown>;
} {
  const used: string[] = [];
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (typeof v === "string" && /^(https?:|urn:)/i.test(v)) {
      used.push(v);
    } else {
      extra[k] = v;
    }
  }
  return { used, extra };
}

function buildSolrProvDoc(
  req: NormalisedIptRequest,
  stored: StoredProvActivity,
  endedAt: string,
  extraFromOutputs?: Record<string, unknown>
): SolrProvDoc {
  const { used, extra } = extractUsedURIs(req.inputs);
  const jsonld = {
    "@context": {
      prov: "http://www.w3.org/ns/prov#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
    "@id": req.activity_id,
    "@type": "prov:Activity",
    "prov:type": { "@id": activityTypeUri(req.process_id) },
    "prov:wasAssociatedWith": { "@id": req.agent_id },
    "prov:used": used.map((u) => ({ "@id": u })),
    "prov:generated": [{ "@id": req.result_id }],
    "prov:startedAtTime": { "@value": req.started_at, "@type": "xsd:dateTime" },
    "prov:endedAtTime": { "@value": endedAt, "@type": "xsd:dateTime" },
    extra: {
      ...(Object.keys(extra).length > 0 ? { inputs: extra } : {}),
      ...(extraFromOutputs ?? {}),
      d120_activity_uuid: stored.uuid,
      d120_process_id: req.process_id,
      d120_client_provided: req.clientProvided,
    },
  };
  return {
    id: stored.uuid,
    prov_id: req.activity_id,
    prov_activityType: activityTypeUri(req.process_id),
    prov_agent: req.agent_id,
    prov_used: used,
    prov_generated: [req.result_id],
    prov_startedAt: req.started_at,
    prov_endedAt: endedAt,
    prov_jsonld: JSON.stringify(jsonld),
  };
}

export function emitSidecarInBackground(
  cfg: Config,
  req: NormalisedIptRequest,
  stored: StoredProvActivity,
  endedAt: string,
  extraFromOutputs?: Record<string, unknown>
): void {
  // Skip when HQ is not configured (dev / test / air-gapped demo).
  if (!cfg.hq.baseUrl) return;
  const doc = buildSolrProvDoc(req, stored, endedAt, extraFromOutputs);
  // Fire-and-forget: no await, no throw-through.
  void putSidecar(cfg, stored.uuid, doc as unknown as Record<string, unknown>).catch((err) => {
    console.error(
      `[sidecar-writer] failed to write ${stored.uuid} for activity ${req.activity_id}:`,
      err
    );
  });
}

/**
 * Compose a Bundle sidecar for a composite process (rag-workflow today).
 *
 * A `prov:Bundle` is PROV's named-provenance-subgraph concept: itself an
 * Entity, so it can carry its own assertion metadata (who asserted, when),
 * and it holds a set of `prov:Activity` / `prov:Entity` statements as members
 * via JSON-LD's named-graph form (@graph). See bblocks-prov-jsonld-alt's
 * README for the design rationale — it's the "unclaimed territory" both
 * OSC PROV bblocks flagged.
 *
 * D120 emits Bundle sidecars ALONGSIDE the individual per-activity sidecars
 * (not instead of), so existing Solr queries like
 *   q=prov_activityType:"https://voyager.ogc/prov/activity/retrieve"
 * still find each retrieve step; the Bundle adds one addressable trace URI
 * that names the whole composite in one document.
 *
 * The Bundle's own prov_activityType is the composite's own type URI
 * (rag-workflow), so it groups in the same Solr facet bucket as the
 * composite's parent activity sidecar.
 */
export interface BundleMember {
  /** Full prov:Activity JSON-LD block as already built by wrapWithProvenance. */
  block: Record<string, unknown>;
  /** Activity IRI (echoed for prov_used / prov_generated aggregation). */
  activityIri: string;
  /** Agent IRI (union across members goes onto the Bundle's provenance). */
  agentIri: string;
  /** Result IRI (contributes to Bundle-level prov_generated). */
  resultIri: string;
  /** Input IRIs (contributes to Bundle-level prov_used). */
  usedIris: string[];
  /** Timestamps for narrowing the Bundle's span. */
  startedAt: string;
  endedAt: string;
}

function buildBundleSolrProvDoc(
  bundleUuid: string,
  bundleIri: string,
  compositeReq: NormalisedIptRequest,
  compositeEndedAt: string,
  members: BundleMember[]
): SolrProvDoc {
  // Bundle assertion metadata: whoever ran the composite (the composite's
  // own agent) asserted the bundle.
  const asserter = compositeReq.agent_id;
  const startedAt = members.reduce(
    (min, m) => (m.startedAt < min ? m.startedAt : min),
    compositeReq.started_at
  );
  const endedAt = members.reduce(
    (max, m) => (m.endedAt > max ? m.endedAt : max),
    compositeEndedAt
  );

  // Union of input/output IRIs across members. Deduped.
  const usedSet = new Set<string>();
  const generatedSet = new Set<string>();
  for (const m of members) {
    for (const u of m.usedIris) usedSet.add(u);
    generatedSet.add(m.resultIri);
  }

  const jsonld = {
    "@context": {
      prov: "http://www.w3.org/ns/prov#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
    "@id": bundleIri,
    "@type": "prov:Bundle",
    "prov:generatedAtTime": { "@value": endedAt, "@type": "xsd:dateTime" },
    "prov:wasAttributedTo": { "@id": asserter },
    "@graph": members.map((m) => m.block),
    extra: {
      d120_bundle_uuid: bundleUuid,
      d120_composite_process_id: compositeReq.process_id,
      d120_member_count: members.length,
    },
  };

  return {
    id: bundleUuid,
    prov_id: bundleIri,
    // Group under the composite's activity type so Solr facet on
    // prov_activityType finds the Bundle alongside its parent activity.
    prov_activityType: activityTypeUri(compositeReq.process_id),
    prov_agent: asserter,
    prov_used: [...usedSet],
    prov_generated: [...generatedSet],
    prov_startedAt: startedAt,
    prov_endedAt: endedAt,
    prov_jsonld: JSON.stringify(jsonld),
  };
}

export function emitBundleSidecarInBackground(
  cfg: Config,
  bundleUuid: string,
  bundleIri: string,
  compositeReq: NormalisedIptRequest,
  compositeEndedAt: string,
  members: BundleMember[]
): void {
  if (!cfg.hq.baseUrl) return;
  if (members.length === 0) return;
  const doc = buildBundleSolrProvDoc(
    bundleUuid,
    bundleIri,
    compositeReq,
    compositeEndedAt,
    members
  );
  void putSidecar(cfg, bundleUuid, doc as unknown as Record<string, unknown>).catch((err) => {
    console.error(
      `[sidecar-writer] failed to write bundle ${bundleUuid} for composite ${bundleIri}:`,
      err
    );
  });
}

// Exported for the Phase 2 unit test — lets us assert the SolrProvDoc shape
// without needing HQ or the network.
export const _testables = { buildSolrProvDoc, buildBundleSolrProvDoc };
