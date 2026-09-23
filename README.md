# voyager-processes-profiler

Standalone HTTP jacket that exposes Voyager's D100 activity chain as OGC API-Processes 1.0 endpoints conforming to the OSC IPT (Integrity, Provenance, Trust) profile. **OSPD D120 deliverable.**

> **Coming back to this project after a few weeks?** Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture + terminology cheatsheet covering bblocks, PROV, D100/D110/D120, URI namespaces, and the runtime map on the demo EC2.

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

### Playback processes (v0.2 Phase 3 — covering the rest of the D100 12-type enum)

The 10 activity types that don't have callable standalone execution paths in HQ today all ship as **playback** processes: `POST /processes/{id}/execution` with a `subject` (doc id, entity URI, or activity URI) queries Solr `main` for existing PROV records matching that activity type + subject and returns them as if D120 had just executed. Response envelope carries `strategy: "playback"` so callers know it's a historical lookup, not a live run.

| Layer | Process ids |
| ----- | ----------- |
| Layer 2 (RAG ingest) | `connect`, `extract`, `chunk`, `embed` |
| Layer 1 (FAS enrichment / CFP §5.1 geospatial ops) | `geotag`, `classify-commodity`, `classify-region`, `nlp-extract-entities`, `ocr`, `field-normalize` |

Real-execute promotion for these is a v0.3 concern (requires new HQ pathways for pipeline-step-per-doc invocation).

### Composite workflow (v0.2 Phase 4)

The `rag-workflow` process conforms to the OSC workflow bblock (`ogc.osc.api-profiles.processes.workflow`) at the descriptor level: it declares retrieve → rank → generate as a CWL-shape step listing. Execution walks the internal handler chain — each sub-step emits its own PROV sidecar, and `outputs.chain_provenance` names the child activity IRIs. A supplied-CWL runtime lands in v0.3.

```bash
curl -X POST $PUBLIC_BASE_URL/processes/rag-workflow/execution \
  -H 'Content-Type: application/json' \
  -d '{"activity_id":"urn:demo:run:1","inputs":{"query":"wildfire risk models for California","top_k":20,"rerank_k":8}}'
```

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
npm run dev             # http://localhost:4601
npm run check           # type-check
npm test                # vitest
npm run bblocks:refresh # re-mirror OSC bblock sources into src/bblocks/mirror
```

The mirrored OSC bblock sources live in [src/bblocks/mirror/](src/bblocks/mirror/). `npm run bblocks:refresh` re-fetches them and rewrites `manifest.json` with the current SHAs; if the fetched shape drifts from what our runtime code depends on, `tests/bblock-conformance.spec.ts` fails and we update D120 to match.

## Federation with D110 register

See [docs/D110-INTEGRATION.md](docs/D110-INTEGRATION.md) for how D120 process URLs wire into Voyager's OSPD Definitions Register contribution.

```bash
npm run register:jsonld -- --file rows.json --out register.jsonld
```

Produces a self-contained JSON-LD dump of the register — ready for Nick's LD-client testing or direct import into the OSC-side register. Example input shape in [docs/examples/register-rows.example.json](docs/examples/register-rows.example.json).

## Deploy

Requires `voyager-prov-ts` checked out as a sibling directory (`../voyager-prov-ts`) — the file: dep in package.json expects it. The Dockerfile builds it via an `additional_contexts:prov` named-context, so no npm publish is needed.

### Standalone (HQ + RAG reachable via host networking)

```bash
cp deploy/processes.env.example deploy/processes.env
# edit deploy/processes.env (set HQ_PASSWORD, PUBLIC_BASE_URL, RAG_BASE_URL)
docker compose -f deploy/docker-compose.yml up -d --build
```

Publishes port 4601 on the host.

### Demo EC2 (rag-demo stack already running)

The RAG service on the demo box does NOT publish 4500 on the host — it runs on the `voyager-rag-demo_default` docker network under alias `rag`. Use the demo compose which joins that network:

```bash
cp deploy/processes.env.example deploy/processes.env
# edit deploy/processes.env — leave RAG_BASE_URL=http://rag:4500 (default)
docker compose -f deploy/docker-compose.demo.yml --env-file deploy/processes.env up -d --build
```

Publishes port 4601 on the host + joins the rag-demo network for `rag:4500`.

HQ remains on the docker host, reached via `host.docker.internal:4000` in both modes.

## Related repos

- `voyager-prov-ts` — canonical PROV emitter (used via `file:../voyager-prov-ts`)
- `voyager-mastra-full-rag` — the RAG chain this service jackets
- `voyager-hq-3.x-mcp` — the HQ REST client patterns we reuse

## Standards references

- [OGC API - Processes 1.0](https://docs.ogc.org/is/18-062r2/18-062r2.html)
- [OSC IPT profile (bblock source)](https://github.com/ogcincubator/bblocks-openscience/tree/master/_sources/api-profiles/processes/ipt)
- [OSC OSPD profile (bblock source)](https://github.com/ogcincubator/bblocks-openscience/tree/master/_sources/api-profiles/processes/ospd)
- [Plan file](../../.claude/plans/d120-processes-profiler.md)
