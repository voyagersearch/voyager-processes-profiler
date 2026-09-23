/**
 * Shape contract tests — validate the IPT-normalisation layer without
 * touching HQ or the RAG service. Uses the internal normaliseIptRequest +
 * wrapWithProvenance helpers directly.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { normaliseIptRequest, wrapWithProvenance } from "../src/prov/emit.js";
import type { Config } from "../src/config.js";
import type { ProcessToggle } from "../src/processes/toggle.js";

const cfg: Config = {
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
  toggleOverride: "",
};

const permissive: ProcessToggle = { maturity: "beta", enabled: true, iptCompliance: "permissive" };
const strict: ProcessToggle = { maturity: "stable", enabled: true, iptCompliance: "strict" };

describe("IPT execute normalisation", () => {
  beforeEach(() => {
    process.env.PROCESSES_TOGGLE_OVERRIDE = "";
  });

  it("strict mode rejects requests missing activity_id", () => {
    const result = normaliseIptRequest({ inputs: { query: "hi" } }, "retrieve", cfg, strict);
    expect("error" in result).toBe(true);
  });

  it("strict mode rejects requests missing agent_id", () => {
    const result = normaliseIptRequest(
      { activity_id: "urn:x", inputs: {} },
      "retrieve",
      cfg,
      strict
    );
    expect("error" in result && (result as { error: string }).error).toMatch(/agent_id/);
  });

  it("permissive mode mints all three IRIs when missing", () => {
    const result = normaliseIptRequest({ inputs: { query: "hi" } }, "retrieve", cfg, permissive);
    if ("error" in result) throw new Error("expected success, got " + result.error);
    expect(result.activity_id).toMatch(/^http:\/\/localhost:4600\/prov\/activity\//);
    expect(result.agent_id).toMatch(/^http:\/\/localhost:4600\/prov\/agent\/retrieve\//);
    expect(result.result_id).toMatch(/^http:\/\/localhost:4600\/prov\/entity\//);
    expect(result.clientProvided).toEqual({ activity_id: false, agent_id: false, result_id: false });
  });

  it("permissive mode echoes client-provided IRIs verbatim", () => {
    const body = {
      activity_id: "urn:client:run:1",
      agent_id: "urn:client:agent:1",
      result_id: "urn:client:result:1",
      inputs: { query: "hi" },
    };
    const result = normaliseIptRequest(body, "retrieve", cfg, permissive);
    if ("error" in result) throw new Error("unexpected error " + result.error);
    expect(result.activity_id).toBe("urn:client:run:1");
    expect(result.agent_id).toBe("urn:client:agent:1");
    expect(result.result_id).toBe("urn:client:result:1");
    expect(result.clientProvided.activity_id).toBe(true);
  });
});

describe("wrapWithProvenance", () => {
  it("wraps outputs with an inline prov:Activity block echoing the IPT IRIs", () => {
    const req = normaliseIptRequest(
      {
        activity_id: "urn:client:run:2",
        agent_id: "urn:client:agent:2",
        result_id: "urn:client:result:2",
        inputs: {},
      },
      "generate",
      cfg,
      permissive
    );
    if ("error" in req) throw new Error("unexpected " + req.error);

    const wrapped = wrapWithProvenance({ answer: "yes" }, req);
    expect(wrapped.answer).toBe("yes");
    const prov = wrapped.provenance as Record<string, unknown>;
    expect(prov["@type"]).toBe("prov:Activity");
    expect(prov["@id"]).toBe("urn:client:run:2");
    expect(prov["prov:type"]).toBe("generate");
    expect((prov["prov:wasAssociatedWith"] as Record<string, unknown>)["@id"]).toBe(
      "urn:client:agent:2"
    );
    expect((prov["prov:generated"] as Record<string, unknown>)["@id"]).toBe("urn:client:result:2");
  });
});
