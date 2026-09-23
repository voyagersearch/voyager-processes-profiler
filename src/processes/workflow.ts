/**
 * Workflow composite process — conforms to
 * `ogc.osc.api-profiles.processes.workflow` at the descriptor level: the
 * process is declared as a workflow composing retrieve → rank → generate,
 * with a CWL-shaped step listing so tools that read the description can see
 * the graph. Execution walks the internal handler chain rather than parsing
 * a supplied CWL document — a real CWL runtime is a v0.3 concern.
 *
 * Provenance shape (matches the workflow bblock's expectation that a
 * composite emits both its own activity AND its constituent activities):
 *  - Each sub-step (retrieve/rank/generate) executes through its own real
 *    handler → wrapWithProvenance → sidecar-writer path, so each gets its
 *    own PROV activity + Solr sidecar.
 *  - The composite's own activity is minted by the parent execution route
 *    (as normal) and `chain_provenance` on the outputs lists the child
 *    activity_ids so consumers can walk from parent to children.
 *  - Child activity IRIs derive from the parent's activity_id + a step
 *    suffix so a client can predict them.
 */

import type { Config } from "../config.js";
import type { NormalisedIptRequest } from "../prov/emit.js";
import { emitSidecarInBackground } from "../prov/sidecar-writer.js";
import { wrapWithProvenance } from "../prov/emit.js";
import { generateHandler } from "./generate.js";
import { rankHandler } from "./rank.js";
import { retrieveHandler } from "./retrieve.js";
import type { ProcessMeta } from "./registry.js";

export const workflowProcessMeta: ProcessMeta = {
  id: "rag-workflow",
  title: "RAG workflow — composed retrieve → rank → generate",
  description:
    "Composite process conforming to ogc.osc.api-profiles.processes.workflow. Executes retrieve → rank → generate as an internal chain; each sub-step emits its own PROV sidecar and the composite emits a parent activity that references its children via wasInformedBy. CWL-shaped descriptor with internal walker in v0.2 — a supplied-CWL executor lands in v0.3.",
  version: "0.2",
  inputs: {
    query: {
      title: "Query",
      description: "The question / search string driving the whole chain",
      schema: { type: "string" },
      minOccurs: 1,
      maxOccurs: 1,
    },
    top_k: {
      title: "Retrieve top K",
      description: "Candidates to pull from retrieve before rerank",
      schema: { type: "integer", default: 20, minimum: 1, maximum: 100 },
      minOccurs: 0,
      maxOccurs: 1,
    },
    rerank_k: {
      title: "Rank top K",
      description: "Candidates to keep after rerank, fed as context to generate",
      schema: { type: "integer", default: 8, minimum: 1, maximum: 50 },
      minOccurs: 0,
      maxOccurs: 1,
    },
    collection: {
      title: "Collection",
      schema: { type: "string", default: "main" },
      minOccurs: 0,
      maxOccurs: 1,
    },
  },
  outputs: {
    answer: {
      title: "Generated answer",
      schema: { type: "string" },
    },
    candidates: {
      title: "Retrieved candidates (pre-rerank)",
      schema: { type: "array", items: { type: "object" } },
    },
    ranked: {
      title: "Ranked candidates (post-rerank)",
      schema: { type: "array", items: { type: "object" } },
    },
    chain_provenance: {
      title: "Child activity IRIs",
      description:
        "Ordered list of the retrieve/rank/generate activity IRIs the composite delegated to. Each resolves via /prov/activity/{uuid} on this service (if v0.2 sidecar is enabled) and via the register's Solr on HQ.",
      schema: {
        type: "object",
        properties: {
          retrieve: { type: "string" },
          rank: { type: "string" },
          generate: { type: "string" },
        },
      },
    },
    workflow: {
      title: "CWL-shape step listing (informational)",
      description:
        "The chain we walked, in CWL step order. Not a live CWL document — v0.2 walker.",
      schema: { type: "object" },
    },
  },
};

interface WorkflowInputs {
  query: string;
  top_k?: number;
  rerank_k?: number;
  collection?: string;
}

// Build a child request that inherits IPT identity from the parent but scopes
// activity_id / result_id per step so each sub-emission has its own IRIs.
function childRequest(
  parent: NormalisedIptRequest,
  step: string,
  inputs: Record<string, unknown>
): NormalisedIptRequest {
  return {
    activity_id: `${parent.activity_id}#step=${step}`,
    agent_id: `${parent.agent_id}#step=${step}`,
    result_id: `${parent.result_id}#step=${step}`,
    process_id: step,
    started_at: new Date().toISOString(),
    inputs,
    // Child requests are always internally-derived; not client-provided.
    clientProvided: { activity_id: false, agent_id: false, result_id: false },
  };
}

async function runChild(
  parent: NormalisedIptRequest,
  cfg: Config,
  step: "retrieve" | "rank" | "generate",
  handler: (r: NormalisedIptRequest, c: Config) => Promise<Record<string, unknown>>,
  inputs: Record<string, unknown>
): Promise<{ outputs: Record<string, unknown>; activity_id: string }> {
  const child = childRequest(parent, step, inputs);
  const outputs = await handler(child, cfg);
  // Wrap + emit sidecar so each sub-step is discoverable in Solr the same
  // way any top-level D120 execution is.
  const wrap = wrapWithProvenance(outputs, child, {
    mode: "inline",
    publicBaseUrl: cfg.publicBaseUrl,
  });
  emitSidecarInBackground(cfg, child, wrap.stored, wrap.endedAt);
  return { outputs: wrap.outputs, activity_id: child.activity_id };
}

export async function workflowHandler(
  req: NormalisedIptRequest,
  cfg: Config
): Promise<Record<string, unknown>> {
  const inputs = (req.inputs ?? {}) as unknown as WorkflowInputs;
  if (!inputs.query || typeof inputs.query !== "string") {
    throw new Error("inputs.query is required (non-empty string)");
  }
  const topK = Math.max(1, Math.min(100, Number(inputs.top_k ?? 20)));
  const rerankK = Math.max(1, Math.min(50, Number(inputs.rerank_k ?? 8)));
  const collection = inputs.collection ?? "main";

  // Step 1 — retrieve
  const retrieved = await runChild(req, cfg, "retrieve", retrieveHandler, {
    query: inputs.query,
    top_k: topK,
    collection,
  });
  const candidates = (retrieved.outputs.candidates as unknown[]) ?? [];

  // Step 2 — rank (uses HTTP strategy if configured; score-sort otherwise)
  const ranked = await runChild(req, cfg, "rank", rankHandler, {
    candidates,
    query: inputs.query,
    top_k: rerankK,
  });
  const rankedList = (ranked.outputs.ranked as unknown[]) ?? [];

  // Step 3 — generate
  const generated = await runChild(req, cfg, "generate", generateHandler, {
    query: inputs.query,
    collection,
    // Context is passed via query for now; a richer contract lands with the
    // real CWL executor in v0.3.
  });

  return {
    answer: generated.outputs.answer ?? "",
    candidates,
    ranked: rankedList,
    chain_provenance: {
      retrieve: retrieved.activity_id,
      rank: ranked.activity_id,
      generate: generated.activity_id,
    },
    workflow: {
      // CWL-shape listing (informational — not a live CWL document)
      class: "Workflow",
      cwlVersion: "v1.2",
      steps: {
        retrieve: {
          run: `${cfg.publicBaseUrl}/processes/retrieve`,
          in: { query: "query", top_k: "top_k", collection: "collection" },
          out: ["candidates"],
        },
        rank: {
          run: `${cfg.publicBaseUrl}/processes/rank`,
          in: { candidates: "retrieve/candidates", query: "query", top_k: "rerank_k" },
          out: ["ranked"],
        },
        generate: {
          run: `${cfg.publicBaseUrl}/processes/generate`,
          in: { query: "query", collection: "collection" },
          out: ["answer"],
        },
      },
    },
  };
}
