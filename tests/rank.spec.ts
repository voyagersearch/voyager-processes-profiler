/**
 * rank handler tests. HTTP rerank strategy is verified by stubbing global.fetch;
 * the score-sort fallback runs offline.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { rankHandler } from "../src/processes/rank.js";
import type { Config } from "../src/config.js";
import type { NormalisedIptRequest } from "../src/prov/emit.js";

const baseCfg: Config = {
  port: 4600,
  publicBaseUrl: "http://localhost:4600",
  registerBaseUrl: "",
  hq: {
    baseUrl: "",
    username: "admin",
    password: "voyager",
    provRoot: "py",
    provSubpath: "test_data/prov",
    provConcurrency: 1,
  },
  rag: { baseUrl: "" },
  rank: { apiUrl: "", apiKey: "", model: "rerank-english-v3.0" },
  toggleOverride: "",
};

function makeReq(inputs: Record<string, unknown>): NormalisedIptRequest {
  return {
    activity_id: "urn:x",
    agent_id: "urn:a",
    result_id: "urn:r",
    process_id: "rank",
    started_at: new Date().toISOString(),
    inputs,
    clientProvided: { activity_id: true, agent_id: true, result_id: true },
  };
}

describe("rank handler — score-sort fallback", () => {
  it("returns descending-score top_k when RANK_API_URL is unset", async () => {
    const candidates = [
      { id: "a", score: 0.5 },
      { id: "b", score: 0.9 },
      { id: "c", score: 0.1 },
      { id: "d", score: 0.7 },
    ];
    const result = await rankHandler(
      makeReq({ candidates, top_k: 2 }),
      baseCfg
    );
    expect(result.rank_strategy).toBe("score-sort");
    const ranked = result.ranked as Array<{ id: string; rank_score: number }>;
    expect(ranked.map((r) => r.id)).toEqual(["b", "d"]);
    expect(ranked[0].rank_score).toBe(0.9);
  });

  it("falls back to score-sort when RANK_API_URL is set but no query provided", async () => {
    const result = await rankHandler(
      makeReq({ candidates: [{ id: "x", score: 1 }] }),
      { ...baseCfg, rank: { ...baseCfg.rank, apiUrl: "http://rerank.local" } }
    );
    expect(result.rank_strategy).toBe("score-sort");
  });
});

describe("rank handler — HTTP rerank strategy", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            results: [
              { index: 2, relevance_score: 0.99 },
              { index: 0, relevance_score: 0.55 },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("posts to /v1/rerank when configured and returns http strategy", async () => {
    const candidates = [
      { id: "a", title: "alpha", score: 0.3 },
      { id: "b", title: "beta", score: 0.4 },
      { id: "c", title: "gamma", score: 0.2 },
    ];
    const result = await rankHandler(
      makeReq({ candidates, query: "greek letters", top_k: 3 }),
      { ...baseCfg, rank: { apiUrl: "http://rerank.local", apiKey: "k", model: "bge-reranker-base" } }
    );
    expect(result.rank_strategy).toBe("http");
    const ranked = result.ranked as Array<{ id: string; rank_score: number }>;
    expect(ranked.map((r) => r.id)).toEqual(["c", "a"]);
    expect(ranked[0].rank_score).toBe(0.99);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://rerank.local/v1/rerank");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("bge-reranker-base");
    expect(body.query).toBe("greek letters");
    expect(body.documents).toEqual(["alpha", "beta", "gamma"]);
  });

  it("falls back to score-sort when HTTP rerank throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 503 }))
    );
    const result = await rankHandler(
      makeReq({
        candidates: [
          { id: "a", title: "x", score: 0.1 },
          { id: "b", title: "y", score: 0.9 },
        ],
        query: "q",
      }),
      { ...baseCfg, rank: { apiUrl: "http://rerank.local", apiKey: "", model: "m" } }
    );
    expect(result.rank_strategy).toBe("score-sort");
    const ranked = result.ranked as Array<{ id: string }>;
    expect(ranked[0].id).toBe("b");
  });
});
