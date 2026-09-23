/**
 * End-to-end HTTP smoke over the Hono app. Uses `app.fetch(req)` directly so
 * no port needs to be bound and no HQ/RAG service has to be reachable — the
 * retrieve process is stubbed by monkey-patching hqSearch in a companion test.
 *
 * The full retrieve→HQ round-trip is exercised manually via curl once the
 * service is deployed (see README).
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { landingRoute } from "../src/routes/landing.js";
import { conformanceRoute } from "../src/routes/conformance.js";
import { processesRoute } from "../src/routes/processes.js";

function makeApp(): Hono {
  const app = new Hono();
  app.route("/", landingRoute);
  app.route("/conformance", conformanceRoute);
  app.route("/processes", processesRoute);
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

  it("GET /processes lists the enabled processes", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/processes"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { processes: Array<{ id: string }> };
    const ids = body.processes.map((p) => p.id).sort();
    expect(ids).toEqual(["generate", "rank", "retrieve"]);
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
});
