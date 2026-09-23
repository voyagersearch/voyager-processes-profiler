import type { Config } from "../config.js";
import type { NormalisedIptRequest } from "../prov/emit.js";
import type { ProcessMeta } from "./registry.js";

export const generateProcessMeta: ProcessMeta = {
  id: "generate",
  title: "Generate — LLM answer synthesis over retrieved context",
  description:
    "Proxies to the voyager-mastra-full-rag /ask?prov=true endpoint. The full 27-activity RAG chain PROV that RAG service emits is exposed here as this process's provenance graph — the client's activity_id is added as the outer parent so the chain hangs off it.",
  version: "0.1",
  inputs: {
    query: {
      title: "Query",
      schema: { type: "string" },
      minOccurs: 1,
      maxOccurs: 1,
    },
    max_tokens: {
      title: "Max output tokens",
      schema: { type: "integer", default: 512 },
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
    prov_chain: {
      title: "Emitted PROV activities",
      description: "The full chain of prov:Activity objects emitted by the RAG service for this run",
      schema: { type: "array", items: { type: "object" } },
    },
  },
};

interface GenerateInputs {
  query: string;
  max_tokens?: number;
  collection?: string;
}

export async function generateHandler(
  req: NormalisedIptRequest,
  cfg: Config
): Promise<Record<string, unknown>> {
  if (!cfg.rag.baseUrl) {
    throw new Error("RAG_BASE_URL not configured — generate process disabled");
  }
  const inputs = (req.inputs ?? {}) as unknown as GenerateInputs;
  if (!inputs.query || typeof inputs.query !== "string") {
    throw new Error("inputs.query is required (non-empty string)");
  }

  const url = `${cfg.rag.baseUrl}/ask?prov=true`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: inputs.query,
      collection: inputs.collection ?? "main",
      // The RAG service picks the LLM per its own env. max_tokens is a hint.
      max_tokens: inputs.max_tokens ?? 512,
      // Pass the client's activity_id downstream so RAG-emitted PROV can
      // reference us as parent activity (see prov/sink.ts wasInformedBy).
      parent_activity_id: req.activity_id,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RAG /ask HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const payload = (await res.json()) as {
    answer?: string;
    prov?: { activities?: unknown[] };
  };
  return {
    answer: payload.answer ?? "",
    prov_chain: payload.prov?.activities ?? [],
  };
}
