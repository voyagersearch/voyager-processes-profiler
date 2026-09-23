# voyager-processes-profiler

Standalone HTTP jacket that exposes Voyager's D100 activity chain as OGC API-Processes 1.0 endpoints conforming to the OSC IPT (Integrity, Provenance, Trust) profile. **OSPD D120 deliverable.**

## Why standalone

D120 needs to ship on OSPD's timeline, which does not wait for Voyager 26.2 / 27.1 / 27.2 product releases. This service runs beside `voyager-mastra-full-rag` on the demo EC2, calls the same MCP tools the RAG demo already uses, and emits PROV sidecars into HQ via the same `sink.ts` pattern.

Later product bake-in happens through `src/processes/toggle.ts` — the on/off-per-activity layer that becomes the negotiation surface with HQ 26.x settings.

## Endpoints (OGC API-Processes 1.0 + IPT profile)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET  | `/` | Landing page |
| GET  | `/conformance` | Conformance classes |
| GET  | `/processes` | List of enabled processes |
| GET  | `/processes/{id}` | Process description |
| POST | `/processes/{id}/execution` | Execute (IPT profile: `activity_id` required). Query `?provenance=reference` returns a link to the PROV block instead of inlining it. |
| GET  | `/jobs/{jobId}` | Job status |
| GET  | `/jobs/{jobId}/results` | Job results |
| GET  | `/openapi` | OpenAPI 3.1 spec (YAML by default; JSON on `Accept: application/json`) |
| GET  | `/prov/activity/{uuid}` | The full `prov:Activity` block referenced by `?provenance=reference` responses |

## Process catalog (v0.2)

| id | Backing call | Notes |
| -- | ------------ | ----- |
| `retrieve` | HQ `POST /api/search/{collection}` | Lexical / hybrid over indexed content |
| `rank`     | HTTP rerank (Cohere-shape) → score-sort fallback | Real cross-encoder wire-up per `RANK_API_URL`; falls back to score-descending sort when unset |
| `generate` | RAG service `POST /ask?prov=true`  | Full 27-activity chain surfaces in `prov_chain` output |

Every execution ALSO emits a PROV sidecar into HQ (via `src/prov/sidecar-writer.ts`) — one JSON file under `{HQ_PROV_FILE_ROOT}/{HQ_PROV_SUBPATH}/{shard}/{uuid}.json` picked up by the PROV Records folder repo (`r1a02cbdfdbe`) into Solr `main`. This is how D110 register lookups become able to find D120-emitted runs.

The other 9 activities in the D100 12-type enum (`embed`, `extract`, `answer`, `geotag`, `classify-commodity`, `classify-region`, `nlp-extract-entities`, `ocr`, `field-normalize`) plumb through the same handler shape; landing in v0.2 Phase 3.

## IPT profile (bblock: `ogc.osc.api-profiles.processes.ipt.api`)

Requests to `/processes/{id}/execution` MUST include:

```json
{
  "activity_id": "urn:client:run:2026-09-22T22:15:00Z:query-42",
  "agent_id":    "https://voyagersearch.com/agents/rag-retriever/v1",
  "result_id":   "urn:client:result:2026-09-22T22:15:00Z:query-42",
  "inputs": { "...": "..." }
}
```

`activity_id` is REQUIRED. `agent_id` and `result_id` are minted server-side if omitted (permissive mode) or rejected (strict mode) per `PROCESSES_TOGGLE_OVERRIDE`.

The response envelope includes an inline `outputs.provenance` block conforming to `ogc.osc.api-profiles.processes.ipt.results` — a `prov:Activity` or `prov:Entity` with the client-nominated IRIs echoed back.

## Development

```bash
npm install
cp .env.example .env    # then edit HQ_* + RAG_BASE_URL
npm run dev             # http://localhost:4600
npm run check           # type-check
npm test                # vitest
npm run bblocks:refresh # re-mirror OSC bblock sources into src/bblocks/mirror
```

The mirrored OSC bblock sources live in [src/bblocks/mirror/](src/bblocks/mirror/). `npm run bblocks:refresh` re-fetches them and rewrites `manifest.json` with the current SHAs; if the fetched shape drifts from what our runtime code depends on, `tests/bblock-conformance.spec.ts` fails and we update D120 to match.

## Deploy

```bash
cp deploy/processes.env.example deploy/processes.env
# edit deploy/processes.env
docker compose -f deploy/docker-compose.yml up -d
```

Runs on port 4600 to sit beside the RAG service on 4500. Both share the demo HQ on 4000.

## Related repos

- `voyager-prov-ts` — canonical PROV emitter (used via `file:../voyager-prov-ts`)
- `voyager-mastra-full-rag` — the RAG chain this service jackets
- `voyager-hq-3.x-mcp` — the HQ REST client patterns we reuse

## Standards references

- [OGC API - Processes 1.0](https://docs.ogc.org/is/18-062r2/18-062r2.html)
- [OSC IPT profile (bblock source)](https://github.com/ogcincubator/bblocks-openscience/tree/master/_sources/api-profiles/processes/ipt)
- [OSC OSPD profile (bblock source)](https://github.com/ogcincubator/bblocks-openscience/tree/master/_sources/api-profiles/processes/ospd)
- [Plan file](../../.claude/plans/d120-processes-profiler.md)
