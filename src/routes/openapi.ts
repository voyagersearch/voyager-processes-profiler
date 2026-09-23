import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { load as parseYaml } from "js-yaml";

// Resolve openapi/voyager-processes.yaml relative to the compiled module —
// works in both `npm run dev` (src/routes/openapi.ts → ../../openapi/...) and
// `npm start` (dist/routes/openapi.js → ../../openapi/...) because both trees
// have the same depth from repo root.
const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(HERE, "..", "..", "openapi", "voyager-processes.yaml");

// Load once at startup. If the file is missing we surface it as a 500 at
// request time rather than crashing the server, so the rest of the API stays
// available.
let cachedYaml: string | null = null;
let loadError: string | null = null;
try {
  cachedYaml = readFileSync(SPEC_PATH, "utf8");
} catch (err) {
  loadError = (err as Error).message ?? String(err);
}

export const openapiRoute = new Hono();

openapiRoute.get("/", (c) => {
  if (loadError || cachedYaml == null) {
    return c.json(
      { type: "NoApplicableCode", title: "OpenAPI spec unavailable", detail: loadError, status: 500 },
      500
    );
  }
  const accept = (c.req.header("accept") ?? "").toLowerCase();
  const wantsJson = accept.includes("application/json") || accept.includes("+json");
  if (wantsJson) {
    try {
      const parsed = parseYaml(cachedYaml);
      return c.json(parsed as Record<string, unknown>);
    } catch (err) {
      return c.json(
        {
          type: "NoApplicableCode",
          title: "OpenAPI YAML failed to parse",
          detail: (err as Error).message,
          status: 500,
        },
        500
      );
    }
  }
  return c.body(cachedYaml, 200, { "Content-Type": "application/vnd.oai.openapi;version=3.1" });
});
