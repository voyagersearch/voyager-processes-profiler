import type { Config } from "../config.js";
import type { NormalisedIptRequest } from "../prov/emit.js";
import { rerankHttp, type RerankInputDoc } from "./rank-client.js";
import type { ProcessMeta } from "./registry.js";

export const rankProcessMeta: ProcessMeta = {
  id: "rank",
  title: "Rank — Cohere-shape HTTP rerank (falls back to score-sort)",
  description:
    "If RANK_API_URL is configured, sends candidates + query to the /v1/rerank endpoint (Cohere API shape — works with self-hosted bge-reranker-base, Voyage AI, Jina, Cohere itself) and returns the top_n by relevance_score. If RANK_API_URL is unset, falls back to descending score-sort of candidates' existing score field. Emits a prov:Activity of type 'rank' whose used=input candidate URIs and generated=result_id.",
  version: "0.2",
  inputs: {
    candidates: {
      title: "Candidate documents",
      description: "Output of a retrieve process (array of {id, title/text, score, ...})",
      schema: { type: "array", items: { type: "object" } },
      minOccurs: 1,
      maxOccurs: 1,
    },
    query: {
      title: "Query",
      description: "Required for HTTP rerank strategy. Ignored by score-sort fallback.",
      schema: { type: "string" },
      minOccurs: 0,
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
      description:
        "Descending-relevance list. Each item carries an added `rank_score` field. `rank_strategy` on the output envelope names which path ran.",
      schema: { type: "array", items: { type: "object" } },
    },
    rank_strategy: {
      title: "Strategy used",
      description: "'http' | 'score-sort'. Reflects which path the request took.",
      schema: { type: "string" },
    },
  },
};

interface RankInputs {
  candidates: Array<Record<string, unknown> & { score?: number; title?: string; text?: string; snippet?: string; id?: string }>;
  query?: string;
  top_k?: number;
}

function extractDocText(c: Record<string, unknown>): string {
  const t = (c.text ?? c.snippet ?? c.title ?? "") as unknown;
  return typeof t === "string" ? t : "";
}

export async function rankHandler(
  req: NormalisedIptRequest,
  cfg: Config
): Promise<Record<string, unknown>> {
  const inputs = (req.inputs ?? {}) as unknown as RankInputs;
  if (!Array.isArray(inputs.candidates)) {
    throw new Error("inputs.candidates must be an array");
  }
  const topK = Math.max(1, Math.min(100, Number(inputs.top_k ?? 10)));

  const httpConfigured = cfg.rank.apiUrl.length > 0;
  const hasQuery = typeof inputs.query === "string" && inputs.query.length > 0;

  if (httpConfigured && hasQuery) {
    const rerankInputs: RerankInputDoc[] = inputs.candidates.map((c, i) => ({
      id: (c.id as string | undefined) ?? String(i),
      text: extractDocText(c),
    }));
    try {
      const reranked = await rerankHttp(cfg, inputs.query!, rerankInputs, topK);
      const ranked = reranked.map((r) => ({
        ...inputs.candidates[r.index],
        rank_score: r.score,
      }));
      return { ranked, rank_strategy: "http" };
    } catch (err) {
      // Rerank service failure = fall back to score-sort with a note. Do NOT
      // fail the whole request; rank is a nice-to-have layer over retrieve.
      console.error(`[rank] HTTP rerank failed, falling back to score-sort:`, err);
    }
  }

  const ranked = [...inputs.candidates]
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, topK)
    .map((c) => ({ ...c, rank_score: Number(c.score ?? 0) }));
  return { ranked, rank_strategy: "score-sort" };
}
