/**
 * Playback-strategy factory. Layer 1 activities (geotag / classify-* / ocr /
 * nlp-extract-entities / field-normalize) and most Layer 2 non-terminal
 * activities (connect / extract / chunk / embed) do not have callable
 * standalone execution paths in HQ today — they emit PROV as side effects
 * of pipeline runs on ingested docs.
 *
 * Playback surfaces them anyway: `POST /processes/{id}/execution` with an
 * input identifying an existing subject (doc id, chunk id, or seed IRI)
 * queries Solr `main` for PROV records matching that activity type + subject
 * and returns them as if D120 had just executed the process. Response shape
 * is on-the-wire indistinguishable from a real execute.
 *
 * The process description declares "execution": "playback" so callers know
 * this is a historical lookup, not a real run. Real-execute promotion is a
 * v0.3 concern (requires new HQ pathways for pipeline-step-per-doc).
 */

import type { Config } from "../config.js";
import type { NormalisedIptRequest } from "../prov/emit.js";
import { hqSearch, type HqDoc } from "../prov/sink.js";
import type { ProcessMeta } from "./registry.js";

export interface PlaybackDefinition {
  /** The activity type — what we query prov_activityType by. */
  activityType: string;
  /** Human-readable process title. */
  title: string;
  /** One-liner for the process description. */
  description: string;
}

const COMMON_INPUTS = {
  subject: {
    title: "Subject",
    description:
      "Doc id, entity URI, or activity URI to look up. Matched against prov_used, prov_generated, and doc id fields.",
    schema: { type: "string" },
    minOccurs: 1,
    maxOccurs: 1,
  },
  limit: {
    title: "Max playback hits",
    schema: { type: "integer", default: 10, minimum: 1, maximum: 100 },
    minOccurs: 0,
    maxOccurs: 1,
  },
} as const;

const COMMON_OUTPUTS = {
  hits: {
    title: "Historical PROV activities matching the subject",
    description:
      "Each item carries {prov_id, prov_agent, prov_used, prov_generated, prov_startedAt, prov_endedAt, prov_jsonld}. Empty array = no historical execution found.",
    schema: { type: "array", items: { type: "object" } },
  },
  strategy: {
    title: "Strategy used",
    description: "Always 'playback' in v0.2. Real-execute strategy lands in v0.3.",
    schema: { type: "string" },
  },
};

export function buildPlaybackMeta(def: PlaybackDefinition): ProcessMeta {
  return {
    id: def.activityType,
    title: def.title,
    description: `${def.description} [Strategy: PLAYBACK — v0.2 surfaces historical PROV records from Solr rather than re-executing the underlying operation. v0.3 promotes to real-execute where an HQ pathway exists.]`,
    version: "0.2",
    inputs: COMMON_INPUTS,
    outputs: COMMON_OUTPUTS,
  };
}

interface PlaybackInputs {
  subject: string;
  limit?: number;
}

// Escape a Solr string-literal value for use inside "value" quoting.
function solrQuote(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildPlaybackHandler(def: PlaybackDefinition) {
  return async function playbackHandler(
    req: NormalisedIptRequest,
    cfg: Config
  ): Promise<Record<string, unknown>> {
    const inputs = (req.inputs ?? {}) as unknown as PlaybackInputs;
    if (!inputs.subject || typeof inputs.subject !== "string") {
      throw new Error("inputs.subject is required (non-empty string)");
    }
    if (!cfg.hq.baseUrl) {
      // No HQ configured (dev/test) — return empty playback rather than fail.
      return { hits: [], strategy: "playback" };
    }

    const limit = Math.max(1, Math.min(100, Number(inputs.limit ?? 10)));
    const quoted = solrQuote(inputs.subject);
    // Match activity type + any of: prov_used, prov_generated, or doc id.
    const filter = `prov_activityType:${solrQuote(def.activityType)} AND (prov_used:${quoted} OR prov_generated:${quoted} OR id:${quoted})`;

    const docs: HqDoc[] = await hqSearch(cfg, {
      collection: "main",
      query: "*:*",
      filter,
      limit,
      fields: [
        "prov_id",
        "prov_activityType",
        "prov_agent",
        "prov_used",
        "prov_generated",
        "prov_startedAt",
        "prov_endedAt",
        "prov_jsonld",
      ],
    });

    return { hits: docs, strategy: "playback" };
  };
}

/**
 * All Layer 1 activity types (CFP §5.1 geospatial ops) plus the Layer 2
 * non-terminal activities not already backed by a live handler. Together
 * with the v0.1 retrieve/rank/generate, this brings D120 to full coverage
 * of the D100 12-type activity enum (plus `rank` which D120 adds on top).
 */
export const PLAYBACK_PROCESSES: PlaybackDefinition[] = [
  // Layer 2 (RAG pipeline) — non-terminal steps
  {
    activityType: "connect",
    title: "Connect — connector session opened against a repo",
    description:
      "Historical playback of connector-open activities emitted during ingest by the RAG pipeline.",
  },
  {
    activityType: "extract",
    title: "Extract — text extraction from a source document",
    description:
      "Historical playback of extract activities emitted during ingest — one per document parsed out of a repo.",
  },
  {
    activityType: "chunk",
    title: "Chunk — document split into embedding-sized chunks",
    description:
      "Historical playback of chunk activities emitted during ingest — each chunk activity references its parent extract activity.",
  },
  {
    activityType: "embed",
    title: "Embed — chunk embedded into a vector",
    description:
      "Historical playback of embed activities emitted during ingest — one per chunk that went through the p19efbcf9d58 embed pipeline.",
  },
  // Layer 1 (FAS enrichment / geospatial ops per CFP §5.1)
  {
    activityType: "geotag",
    title: "Geotag — location extraction from doc text",
    description:
      "Historical playback of geotag activities emitted by the demo-fas-showcase pipeline (p19f48e0edb6). Anchored on parent doc id.",
  },
  {
    activityType: "classify-commodity",
    title: "Classify commodity — FAS commodity tagging",
    description:
      "Historical playback of commodity classification activities emitted by demo-fas-showcase.",
  },
  {
    activityType: "classify-region",
    title: "Classify region — FAS region tagging",
    description:
      "Historical playback of region classification activities. Note demo-fas-showcase emits both region-classify + grp-tagger as classify-region records.",
  },
  {
    activityType: "nlp-extract-entities",
    title: "NLP extract entities — named entity recognition",
    description:
      "Historical playback of NLP entity extraction activities emitted by demo-fas-showcase.",
  },
  {
    activityType: "ocr",
    title: "OCR — text recognition from image content",
    description:
      "Historical playback of OCR activities emitted by demo-fas-showcase against image / scanned-doc inputs.",
  },
  {
    activityType: "field-normalize",
    title: "Field normalize — schema-field normalisation",
    description:
      "Historical playback of field-normalize activities emitted by demo-fas-showcase as the last step of the FAS enrichment chain.",
  },
];
