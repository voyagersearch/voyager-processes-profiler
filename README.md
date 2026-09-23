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
| POST | `/processes/{id}/execution` | Execute (IPT profile: `activity_id` required) |
| GET  | `/jobs/{jobId}` | Job status |
| GET  | `/jobs/{jobId}/results` | Job results |

## First-cut process catalog (v0.1)

| id | Backing call | Activity type emitted |
| -- | ------------ | --------------------- |
| `retrieve` | HQ `POST /api/search/{collection}` | `retrieve` |
| `rank`     | Local reranker stub                | `rank` |
| `generate` | RAG service `POST /ask?prov=true`  | `generate` (+ chain via prov-sink) |

The other 9 activities in the D100 12-type enum (`embed`, `extract`, `answer`, `geotag`, `classify-commodity`, `classify-region`, `nlp-extract-entities`, `ocr`, `field-normalize`) plumb through the same handler shape; add them in v0.2.

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
```

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
