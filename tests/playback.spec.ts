/**
 * Playback-factory tests. Verifies the metadata factory produces conformant
 * ProcessMeta shapes and that the handler queries HQ correctly (with global.fetch
 * stubbed) + returns empty when HQ is unconfigured.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  buildPlaybackHandler,
  buildPlaybackMeta,
  PLAYBACK_PROCESSES,
} from "../src/processes/playback-factory.js";
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
  rank: { apiUrl: "", apiKey: "", model: "m" },
  toggleOverride: "",
};

function makeReq(inputs: Record<string, unknown>, processId: string): NormalisedIptRequest {
  return {
    activity_id: "urn:x",
    agent_id: "urn:a",
    result_id: "urn:r",
    process_id: processId,
    started_at: new Date().toISOString(),
    inputs,
    clientProvided: { activity_id: true, agent_id: true, result_id: true },
  };
}

describe("PLAYBACK_PROCESSES catalog", () => {
  it("covers the 10 D100 activity types not already backed by a real handler", () => {
    const ids = PLAYBACK_PROCESSES.map((p) => p.activityType).sort();
    expect(ids).toEqual(
      [
        "chunk",
        "classify-commodity",
        "classify-region",
        "connect",
        "embed",
        "extract",
        "field-normalize",
        "geotag",
        "nlp-extract-entities",
        "ocr",
      ].sort()
    );
  });

  it("every entry produces a ProcessMeta with declared inputs/outputs", () => {
    for (const p of PLAYBACK_PROCESSES) {
      const m = buildPlaybackMeta(p);
      expect(m.id).toBe(p.activityType);
      expect(m.version).toBe("0.2");
      expect(m.inputs).toHaveProperty("subject");
      expect(m.outputs).toHaveProperty("hits");
      expect(m.outputs).toHaveProperty("strategy");
      expect(m.description).toMatch(/PLAYBACK/);
    }
  });
});

describe("playback handler — no HQ configured", () => {
  it("returns an empty hits array with strategy='playback'", async () => {
    const handler = buildPlaybackHandler({
      activityType: "geotag",
      title: "t",
      description: "d",
    });
    const res = await handler(makeReq({ subject: "urn:voyager:doc:xyz" }, "geotag"), baseCfg);
    expect(res.hits).toEqual([]);
    expect(res.strategy).toBe("playback");
  });

  it("rejects requests missing subject", async () => {
    const handler = buildPlaybackHandler({
      activityType: "ocr",
      title: "t",
      description: "d",
    });
    await expect(handler(makeReq({}, "ocr"), baseCfg)).rejects.toThrow(/subject/);
  });
});

describe("playback handler — HQ query stubbed", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        // Auth handshake — return a set-cookie so ensureLogin succeeds.
        if (input.includes("/api/auth/realms/internal/login")) {
          return new Response("ok", {
            status: 200,
            headers: { "set-cookie": "vg-token=fake-token; Path=/" },
          });
        }
        // The Solr-side query — return two synthetic hits.
        if (input.includes("/api/search/main")) {
          return new Response(
            JSON.stringify({
              response: {
                docs: [
                  {
                    prov_id: "urn:voyager:prov:activity:aaaa",
                    prov_activityType: "geotag",
                    prov_agent: "urn:voyager:agent:geotag",
                    prov_used: ["urn:voyager:doc:xyz"],
                    prov_generated: ["urn:voyager:doc:xyz+geotag"],
                    prov_startedAt: "2026-01-01T00:00:00Z",
                    prov_endedAt: "2026-01-01T00:00:01Z",
                    prov_jsonld: "{}",
                  },
                  {
                    prov_id: "urn:voyager:prov:activity:bbbb",
                    prov_activityType: "geotag",
                    prov_agent: "urn:voyager:agent:geotag",
                    prov_used: ["urn:voyager:doc:xyz"],
                    prov_generated: [],
                    prov_startedAt: "2026-01-02T00:00:00Z",
                    prov_endedAt: "2026-01-02T00:00:01Z",
                    prov_jsonld: "{}",
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("unexpected", { status: 500 });
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("posts the right filter to Solr and returns hits", async () => {
    const handler = buildPlaybackHandler({
      activityType: "geotag",
      title: "t",
      description: "d",
    });
    const cfg = {
      ...baseCfg,
      hq: { ...baseCfg.hq, baseUrl: "http://hq.local:4000" },
    };
    const res = await handler(makeReq({ subject: "urn:voyager:doc:xyz" }, "geotag"), cfg);
    const hits = res.hits as unknown[];
    expect(hits).toHaveLength(2);
    expect(res.strategy).toBe("playback");

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const searchCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/search/main")
    );
    expect(searchCall).toBeDefined();
    const body = JSON.parse((searchCall![1] as { body: string }).body);
    expect(body.filter).toContain('prov_activityType:"geotag"');
    expect(body.filter).toContain('prov_used:"urn:voyager:doc:xyz"');
  });
});
