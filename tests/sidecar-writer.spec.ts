/**
 * Sidecar-writer unit tests. Exercises the pure SolrProvDoc build path via
 * the exported _testables handle; the actual HTTP POST to HQ is covered by
 * putSidecar's own path (out of scope for unit tests — verified in situ on
 * the demo EC2 after deploy).
 */

import { describe, it, expect } from "vitest";

import { _testables } from "../src/prov/sidecar-writer.js";
import type { NormalisedIptRequest } from "../src/prov/emit.js";
import type { StoredProvActivity } from "../src/prov/store.js";

const startedAt = "2026-09-23T00:00:00.000Z";
const endedAt = "2026-09-23T00:00:01.000Z";

function makeReq(overrides: Partial<NormalisedIptRequest> = {}): NormalisedIptRequest {
  return {
    activity_id: "urn:client:run:xyz",
    agent_id: "urn:client:agent:xyz",
    result_id: "urn:client:result:xyz",
    process_id: "retrieve",
    started_at: startedAt,
    inputs: {},
    clientProvided: { activity_id: true, agent_id: true, result_id: true },
    ...overrides,
  };
}

function makeStored(): StoredProvActivity {
  return {
    uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    activity_id: "urn:client:run:xyz",
    agent_id: "urn:client:agent:xyz",
    result_id: "urn:client:result:xyz",
    process_id: "retrieve",
    block: { "@type": "prov:Activity" },
    created_at: endedAt,
  };
}

describe("buildSolrProvDoc", () => {
  it("maps IPT IRIs onto SolrProvDoc fields verbatim", () => {
    const doc = _testables.buildSolrProvDoc(makeReq(), makeStored(), endedAt);
    expect(doc.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(doc.prov_id).toBe("urn:client:run:xyz");
    expect(doc.prov_activityType).toBe("https://voyager.ogc/prov/activity/retrieve");
    expect(doc.prov_agent).toBe("urn:client:agent:xyz");
    expect(doc.prov_generated).toEqual(["urn:client:result:xyz"]);
    expect(doc.prov_startedAt).toBe(startedAt);
    expect(doc.prov_endedAt).toBe(endedAt);
  });

  it("promotes IRI-shaped inputs into prov_used and drops the rest into extra", () => {
    const doc = _testables.buildSolrProvDoc(
      makeReq({
        inputs: {
          seed_doc: "urn:voyager:doc:123",
          model_ref: "https://voyagersearch.com/models/bge",
          query: "wildfire risk",
          top_k: 10,
        },
      }),
      makeStored(),
      endedAt
    );
    expect(doc.prov_used.sort()).toEqual(
      ["https://voyagersearch.com/models/bge", "urn:voyager:doc:123"].sort()
    );
    const jsonld = JSON.parse(doc.prov_jsonld);
    expect(jsonld.extra.inputs.query).toBe("wildfire risk");
    expect(jsonld.extra.inputs.top_k).toBe(10);
    expect(jsonld.extra.inputs.seed_doc).toBeUndefined();
  });

  it("emits a well-shaped prov:Activity JSON-LD blob", () => {
    const doc = _testables.buildSolrProvDoc(makeReq(), makeStored(), endedAt);
    const jsonld = JSON.parse(doc.prov_jsonld);
    expect(jsonld["@type"]).toBe("prov:Activity");
    expect(jsonld["@id"]).toBe("urn:client:run:xyz");
    expect(jsonld["prov:type"]["@id"]).toBe("https://voyager.ogc/prov/activity/retrieve");
    expect(jsonld["prov:wasAssociatedWith"]).toEqual({ "@id": "urn:client:agent:xyz" });
    expect(jsonld["prov:generated"]).toEqual([{ "@id": "urn:client:result:xyz" }]);
    expect(jsonld["prov:startedAtTime"]["@value"]).toBe(startedAt);
    expect(jsonld.extra.d120_activity_uuid).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(jsonld.extra.d120_process_id).toBe("retrieve");
  });
});
