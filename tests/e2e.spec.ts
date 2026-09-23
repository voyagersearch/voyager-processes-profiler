/**
 * End-to-end HTTP smoke over the Hono app. Uses `app.fetch(req)` directly so
 * no port needs to be bound and no HQ/RAG service has to be reachable.
 *
 * The full retrieve→HQ round-trip is exercised manually via curl once the
 * service is deployed (see README).
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { landingRoute } from "../src/routes/landing.js";
import { conformanceRoute } from "../src/routes/conformance.js";
import { processesRoute } from "../src/routes/processes.js";
import { openapiRoute } from "../src/routes/openapi.js";
import { provRoute } from "../src/routes/prov.js";
import { _resetProvStoreForTests, saveProvActivity } from "../src/prov/store.js";

function makeApp(): Hono {
  const app = new Hono();
  app.route("/", landingRoute);
  app.route("/conformance", conformanceRoute);
  app.route("/processes", processesRoute);
  app.route("/openapi", openapiRoute);
  app.route("/prov", provRoute);
  return app;
}

describe("HTTP surface", () => {
  it("GET / returns a landing document with the required links", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: Array<{ rel: string }> };
    const rels = body.links.map((l) => l.rel);
    expect(rels).toContain("conformance");
    expect(rels).toContain("processes");
    expect(rels).toContain("service-desc");
  });

  it("GET /conformance advertises the IPT bblock", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/conformance"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conformsTo: string[] };
    expect(body.conformsTo.some((u) => u.includes("api-profiles.processes.ipt.api"))).toBe(true);
    expect(
      body.conformsTo.some((u) =>
        u.startsWith("http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/core")
      )
    ).toBe(true);
  });

  it("GET /processes lists the enabled processes (3 real + 10 playback = 13)", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/processes"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { processes: Array<{ id: string }> };
    const ids = body.processes.map((p) => p.id).sort();
    expect(ids).toEqual(
      [
        "chunk",
        "classify-commodity",
        "classify-region",
        "connect",
        "embed",
        "extract",
        "field-normalize",
        "generate",
        "geotag",
        "nlp-extract-entities",
        "ocr",
        "rank",
        "retrieve",
      ].sort()
    );
  });

  it("GET /processes/{id} returns a process description with self + execute links", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/processes/retrieve"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      inputs: Record<string, unknown>;
      links: Array<{ rel: string }>;
    };
    expect(body.id).toBe("retrieve");
    expect(body.inputs.query).toBeDefined();
    const rels = body.links.map((l) => l.rel);
    expect(rels).toContain("self");
    expect(rels.some((r) => r.includes("execute"))).toBe(true);
  });

  it("GET /processes/nope returns 404", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/processes/nope"));
    expect(res.status).toBe(404);
  });

  it("GET /processes/geotag returns a playback-strategy description", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/processes/geotag"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      description: string;
      inputs: Record<string, unknown>;
      outputs: Record<string, unknown>;
    };
    expect(body.id).toBe("geotag");
    expect(body.description).toMatch(/PLAYBACK/);
    expect(body.inputs.subject).toBeDefined();
    expect(body.outputs.hits).toBeDefined();
    expect(body.outputs.strategy).toBeDefined();
  });
});

describe("OpenAPI route", () => {
  it("GET /openapi returns YAML by default", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/openapi"));
    expect(res.status).toBe(200);
    const ctype = res.headers.get("content-type") ?? "";
    expect(ctype).toContain("application/vnd.oai.openapi");
    const text = await res.text();
    expect(text).toMatch(/^openapi:\s*3\.1\.0/m);
  });

  it("GET /openapi with Accept: application/json returns parsed JSON", async () => {
    const res = await makeApp().fetch(
      new Request("http://localhost/openapi", { headers: { Accept: "application/json" } })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openapi: string; info: { title: string } };
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toMatch(/Voyager Processes Profiler/);
  });
});

describe("PROV activity route", () => {
  it("GET /prov/activity/{unknown} returns 404", async () => {
    _resetProvStoreForTests();
    const res = await makeApp().fetch(new Request("http://localhost/prov/activity/nope"));
    expect(res.status).toBe(404);
  });

  it("GET /prov/activity/{uuid} returns the stored block when present", async () => {
    _resetProvStoreForTests();
    saveProvActivity({
      uuid: "abc-123",
      activity_id: "urn:x",
      agent_id: "urn:a",
      result_id: "urn:r",
      process_id: "retrieve",
      block: { "@type": "prov:Activity", "@id": "urn:x" },
      created_at: new Date().toISOString(),
    });
    const res = await makeApp().fetch(new Request("http://localhost/prov/activity/abc-123"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["@type"]).toBe("prov:Activity");
    expect(body["@id"]).toBe("urn:x");
  });
});
