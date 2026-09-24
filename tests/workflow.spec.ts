/**
 * Workflow composite tests. Stubs the RAG service + HQ search endpoints via
 * global.fetch so the whole retrieve → rank → generate chain runs offline.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { workflowHandler, workflowProcessMeta } from "../src/processes/workflow.js";
import type { Config } from "../src/config.js";
import type { NormalisedIptRequest } from "../src/prov/emit.js";

const cfg: Config = {
  port: 4600,
  publicBaseUrl: "http://localhost:4600",
  registerBaseUrl: "",
  hq: {
    baseUrl: "http://hq.local:4000",
    username: "admin",
    password: "voyager",
    provRoot: "py",
    provSubpath: "test_data/prov",
    provConcurrency: 1,
  },
  rag: { baseUrl: "http://rag.local:4500" },
  rank: { apiUrl: "", apiKey: "", model: "m" },
  toggleOverride: "",
};

function req(inputs: Record<string, unknown>): NormalisedIptRequest {
  return {
    activity_id: "urn:client:run:workflow-1",
    agent_id: "urn:client:agent:workflow",
    result_id: "urn:client:result:workflow-1",
    process_id: "rag-workflow",
    started_at: new Date().toISOString(),
    inputs,
    clientProvided: { activity_id: true, agent_id: true, result_id: true },
  };
}

describe("workflowProcessMeta shape", () => {
  it("declares CWL-shape outputs including chain_provenance + workflow blocks", () => {
    expect(workflowProcessMeta.id).toBe("rag-workflow");
    expect(workflowProcessMeta.outputs).toHaveProperty("answer");
    expect(workflowProcessMeta.outputs).toHaveProperty("chain_provenance");
    expect(workflowProcessMeta.outputs).toHaveProperty("workflow");
    expect(workflowProcessMeta.inputs).toHaveProperty("query");
  });
});

describe("workflowHandler — full chain over stubbed HQ + RAG", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        // HQ login handshake
        if (input.includes("/api/auth/realms/internal/login")) {
          return new Response("ok", {
            status: 200,
            headers: { "set-cookie": "vg-token=fake; Path=/" },
          });
        }
        // HQ search (retrieve backing)
        if (input.includes("/api/search/main")) {
          return new Response(
            JSON.stringify({
              response: {
                docs: [
                  { id: "d1", title: "doc one", score: 0.7 },
                  { id: "d2", title: "doc two", score: 0.9 },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        // HQ /api/files POST — sidecar sink. Return 200 so emitSidecar
        // succeeds and does not spam stderr in tests.
        if (input.includes("/api/files/edit/")) {
          return new Response("ok", { status: 200 });
        }
        // RAG /ask (generate backing)
        if (input.includes("/ask")) {
          return new Response(
            JSON.stringify({
              answer: "the answer is 42",
              prov: { activities: [] },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(`unexpected fetch to ${input}`, { status: 500 });
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("walks retrieve → rank → generate and returns the composite output", async () => {
    const result = await workflowHandler(req({ query: "what is the answer" }), cfg);

    expect(result.answer).toBe("the answer is 42");

    const candidates = result.candidates as Array<{ id: string }>;
    expect(candidates.map((c) => c.id)).toEqual(["d1", "d2"]);

    const ranked = result.ranked as Array<{ id: string }>;
    // score-sort (no RANK_API_URL): d2 (0.9) before d1 (0.7)
    expect(ranked.map((c) => c.id)).toEqual(["d2", "d1"]);

    const chain = result.chain_provenance as Record<string, string>;
    expect(chain.retrieve).toContain("#step=retrieve");
    expect(chain.rank).toContain("#step=rank");
    expect(chain.generate).toContain("#step=generate");
    // Bundle IRI names the prov:Bundle sidecar that wraps all three
    expect(chain.bundle).toContain("#bundle");

    const workflow = result.workflow as { class: string; steps: Record<string, unknown> };
    expect(workflow.class).toBe("Workflow");
    expect(Object.keys(workflow.steps).sort()).toEqual(["generate", "rank", "retrieve"]);
  });

  it("rejects requests missing query", async () => {
    await expect(workflowHandler(req({}), cfg)).rejects.toThrow(/query/);
  });
});
