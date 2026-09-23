/**
 * HTTP rerank client. Speaks the Cohere v1 rerank API shape, which is the
 * de-facto convention that self-hosted rerankers (bge-reranker-base behind
 * a small server, Voyage AI, Jina, Cohere itself) all implement.
 *
 * If RANK_API_URL is unset, the rank process falls back to score-descending
 * sort (the v0.1 stub); this client is only called when RANK_API_URL points
 * somewhere that speaks the shape.
 */

import type { Config } from "../config.js";

export interface RerankInputDoc {
  id?: string;
  text: string;
}

export interface RerankOutputDoc {
  id?: string;
  text: string;
  score: number;
  index: number;
}

interface CohereRerankResult {
  index: number;
  relevance_score: number;
}

interface CohereRerankResponse {
  results: CohereRerankResult[];
}

export async function rerankHttp(
  cfg: Config,
  query: string,
  docs: RerankInputDoc[],
  topN: number
): Promise<RerankOutputDoc[]> {
  if (!cfg.rank.apiUrl) {
    throw new Error("RANK_API_URL not configured");
  }
  if (docs.length === 0) return [];

  const url = `${cfg.rank.apiUrl}/v1/rerank`;
  const body = JSON.stringify({
    model: cfg.rank.model,
    query,
    documents: docs.map((d) => d.text),
    top_n: Math.min(topN, docs.length),
    return_documents: false,
  });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.rank.apiKey) headers.Authorization = `Bearer ${cfg.rank.apiKey}`;

  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Rerank ${res.status}: ${text.slice(0, 200)}`);
  }
  const payload = (await res.json()) as CohereRerankResponse;
  return payload.results.map((r) => {
    const source = docs[r.index]!;
    return {
      id: source.id,
      text: source.text,
      score: r.relevance_score,
      index: r.index,
    };
  });
}
