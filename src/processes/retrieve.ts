import type { Config } from "../config.js";
import type { NormalisedIptRequest } from "../prov/emit.js";
import { hqSearch } from "../prov/sink.js";
import type { ProcessMeta } from "./registry.js";

export const retrieveProcessMeta: ProcessMeta = {
  id: "retrieve",
  title: "Retrieve — hybrid/lexical search over indexed content",
  description:
    "Executes a Voyager search against the configured collection and returns candidate documents. Emits a prov:Activity of type 'retrieve' whose IRIs are the client-nominated activity_id / result_id / agent_id.",
  version: "0.1",
  inputs: {
    query: {
      title: "Query",
      description: "Search query string",
      schema: { type: "string" },
      minOccurs: 1,
      maxOccurs: 1,
    },
    top_k: {
      title: "Top K",
      description: "Number of candidates to return",
      schema: { type: "integer", default: 10, minimum: 1, maximum: 100 },
      minOccurs: 0,
      maxOccurs: 1,
    },
    collection: {
      title: "Collection",
      description: "Voyager collection to search (default: main)",
      schema: { type: "string", default: "main" },
      minOccurs: 0,
      maxOccurs: 1,
    },
    profile: {
      title: "Search profile",
      description: "Voyager search profile — default, hybrid, or a named profile",
      schema: { type: "string", default: "default" },
      minOccurs: 0,
      maxOccurs: 1,
    },
  },
  outputs: {
    candidates: {
      title: "Candidate documents",
      description: "Retrieved documents in descending relevance order",
      schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            score: { type: "number" },
            snippet: { type: "string" },
          },
        },
      },
    },
  },
};

interface RetrieveInputs {
  query: string;
  top_k?: number;
  collection?: string;
  profile?: string;
}

export async function retrieveHandler(
  req: NormalisedIptRequest,
  cfg: Config
): Promise<Record<string, unknown>> {
  const inputs = (req.inputs ?? {}) as unknown as RetrieveInputs;
  if (!inputs.query || typeof inputs.query !== "string") {
    throw new Error("inputs.query is required (non-empty string)");
  }
  const collection = inputs.collection ?? "main";
  const topK = Math.max(1, Math.min(100, Number(inputs.top_k ?? 10)));

  const docs = await hqSearch(cfg, {
    collection,
    query: inputs.query,
    limit: topK,
    fields: ["id", "title", "url", "score"],
  });

  return {
    candidates: docs.map((d) => ({
      id: String(d.id ?? ""),
      title: String(d.title ?? ""),
      url: d.url ?? undefined,
      score: typeof d.score === "number" ? d.score : undefined,
    })),
  };
}
