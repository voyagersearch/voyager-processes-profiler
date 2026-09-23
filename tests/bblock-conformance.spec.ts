/**
 * Bblock conformance — asserts the OSC IPT bblock shape we depend on is still
 * what the mirror holds. If OSC changes their bblock and we haven't refreshed,
 * these tests still pass (they read the mirror). Running `npm run bblocks:refresh`
 * pulls a new mirror; if any assertion below fails after a refresh, that IS the
 * signal that OSC changed the contract and D120 code needs a matching update.
 *
 * Kept intentionally close to the runtime dependency list — every assertion
 * corresponds to a line in the code that would break if the OSC shape moved.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import { load as parseYaml } from "js-yaml";

const MIRROR_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "bblocks",
  "mirror"
);

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(MIRROR_DIR, name), "utf8")) as T;
}

function readYaml<T>(name: string): T {
  return parseYaml(readFileSync(join(MIRROR_DIR, name), "utf8")) as T;
}

interface Manifest {
  repo: string;
  ref: string;
  fetched_at: string;
  files: Array<{ source_path: string; mirror_name: string; sha: string; size: number }>;
}

describe("bblocks mirror manifest", () => {
  it("was refreshed from the OSC repo we expect", () => {
    const m = readJson<Manifest>("manifest.json");
    expect(m.repo).toBe("ogcincubator/bblocks-openscience");
    expect(m.ref).toBe("master");
    expect(m.files.length).toBeGreaterThanOrEqual(6);
  });
});

describe("workflow bblock (ogc.osc.api-profiles.processes.workflow)", () => {
  const wf = readJson<{
    itemClass: string;
    dependsOn: string[];
  }>("workflow.bblock.json");

  it("still declares itemClass=api", () => {
    expect(wf.itemClass).toBe("api");
  });

  it("still depends on ipt.api + application-package (composite baseline)", () => {
    // The workflow profile composes on top of the IPT profile + application-package
    // (CWL). The v0.2 workflow process description is CWL-shape informational
    // only — a supplied-CWL executor is v0.3. If dependsOn changes upstream we
    // need to revisit that assumption.
    expect(wf.dependsOn).toContain("ogc.osc.api-profiles.processes.ipt.api");
    expect(wf.dependsOn).toContain("ogc.osc.application-package");
  });
});

describe("ipt/api bblock (ogc.osc.api-profiles.processes.ipt.api)", () => {
  const api = readJson<{
    name: string;
    itemClass: string;
    dependsOn: string[];
  }>("ipt-api.bblock.json");

  it("still declares itemClass=api", () => {
    expect(api.itemClass).toBe("api");
  });

  it("still depends on the ipt.execute and ipt.results sub-bblocks D120 wraps", () => {
    expect(api.dependsOn).toContain("ogc.osc.api-profiles.processes.ipt.execute");
    expect(api.dependsOn).toContain("ogc.osc.api-profiles.processes.ipt.results");
  });
});

describe("ipt/execute schema", () => {
  const schema = readYaml<{
    allOf: Array<{ $ref: string }>;
    properties: {
      inputs: {
        activity_id?: { $ref: string };
        result_id?: { $ref: string };
        agent_id?: { $ref: string };
      };
    };
    required: string[];
  }>("ipt-execute.schema.yaml");

  it("composes on top of ogc.api.processes.v1.schemas.execute", () => {
    const refs = schema.allOf.map((r) => r.$ref);
    expect(refs).toContain("bblocks://ogc.api.processes.v1.schemas.execute");
  });

  it("still declares activity_id / result_id / agent_id as IRI-shaped inputs", () => {
    expect(schema.properties.inputs.activity_id?.$ref).toBe("bblocks://ogc.ogc-utils.iri-or-curie");
    expect(schema.properties.inputs.result_id?.$ref).toBe("bblocks://ogc.ogc-utils.iri-or-curie");
    expect(schema.properties.inputs.agent_id?.$ref).toBe("bblocks://ogc.ogc-utils.iri-or-curie");
  });

  it("still marks activity_id as the only strictly-required IPT input", () => {
    // If OSC ever promotes result_id or agent_id to required, our permissive-mode
    // handling in src/prov/emit.ts stops matching the spec. That's the signal.
    expect(schema.required).toEqual(["activity_id"]);
  });
});

describe("ipt/results schema", () => {
  const schema = readYaml<{
    allOf: Array<{ $ref: string }>;
    properties: {
      value: {
        oneOf: Array<{ $ref: string }>;
      };
    };
  }>("ipt-results.schema.yaml");

  it("composes on qualifiedInputValue from the base API-Processes schemas", () => {
    const refs = schema.allOf.map((r) => r.$ref);
    expect(refs).toContain("bblocks://ogc.api.processes.v1.schemas.qualifiedInputValue");
  });

  it("still constrains value to be prov-entity | prov-activity", () => {
    // If OSC drops prov-activity or renames these, wrapWithProvenance's @type
    // choice must move in lockstep.
    const oneOfRefs = schema.properties.value.oneOf.map((r) => r.$ref);
    expect(oneOfRefs).toContain("bblocks://ogc.ogc-utils.prov-entity");
    expect(oneOfRefs).toContain("bblocks://ogc.ogc-utils.prov-activity");
  });
});
