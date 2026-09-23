import type { Config } from "../config.js";
import type { NormalisedIptRequest } from "../prov/emit.js";
import type { ProcessMeta } from "./registry.js";

export const rankProcessMeta: ProcessMeta = {
  id: "rank",
  title: "Rank — score-based rerank stub",
  description:
    "v0.1: score-descending sort with a top-K cut. Emits a prov:Activity of type 'rank' whose used=candidates and generated=ranked. Real cross-encoder rerank wires in at v0.2.",
  version: "0.1",
  inputs: {
    candidates: {
      title: "Candidate documents",
      description: "Output of a retrieve process (or any array of {id, score, ...})",
      schema: { type: "array", items: { type: "object" } },
      minOccurs: 1,
      maxOccurs: 1,
    },
    top_k: {
      title: "Top K",
      schema: { type: "integer", default: 10, minimum: 1, maximum: 100 },
      minOccurs: 0,
      maxOccurs: 1,
    },
  },
  outputs: {
    ranked: {
      title: "Ranked documents",
      schema: { type: "array", items: { type: "object" } },
    },
  },
};

interface RankInputs {
  candidates: Array<Record<string, unknown> & { score?: number }>;
  top_k?: number;
}

export async function rankHandler(
  req: NormalisedIptRequest,
  _cfg: Config
): Promise<Record<string, unknown>> {
  const inputs = (req.inputs ?? {}) as unknown as RankInputs;
  if (!Array.isArray(inputs.candidates)) {
    throw new Error("inputs.candidates must be an array");
  }
  const topK = Math.max(1, Math.min(100, Number(inputs.top_k ?? 10)));
  const ranked = [...inputs.candidates]
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, topK);
  return { ranked };
}
