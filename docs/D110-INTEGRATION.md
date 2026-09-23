# D110 ↔ D120 Federation

Voyager's OSPD contribution has two paired deliverables:

- **D110** — Definitions Register: 13 rows (10 activity types + 3 umbrella concepts) contributed to the shared OSPD sheet [`1myNRKLghCCaTMaoFjfZjqK6D6MYFqtIn8lxUAIkXBjc`](https://docs.google.com/spreadsheets/d/1myNRKLghCCaTMaoFjfZjqK6D6MYFqtIn8lxUAIkXBjc), tabs *Definitions Register!A41:L53* + *Demo Definition Use!A12:H18*.
- **D120** — Processes Profiler: this repo. Every activity type in the register has a matching `POST /processes/{term}/execution` endpoint here.

This document describes how the two are wired together at the discoverability layer.

## URI scheme (locked per plan)

Both deliverables share `api.voyagersearch.com/ospd/...` as their base so cross-links are one field, not full URLs:

```
Register concept:  https://api.voyagersearch.com/ospd/register/activities/{term}
Process endpoint:  https://api.voyagersearch.com/ospd/processes/{term}
Process execute:   https://api.voyagersearch.com/ospd/processes/{term}/execution
Sidecar PROV:      https://api.voyagersearch.com/ospd/prov/activity/{uuid}
```

`{term}` is the machine-readable slug — `retrieve`, `rank`, `generate`, `geotag`, and so on. It matches the D100 12-type activity enum plus D120's own `rank` and the composite `rag-workflow`.

## C1 — processUrl column (post-deploy)

Once the service is deployed and the URLs above are stable, add a `processUrl` column to the D110 sheet's *Definitions Register* tab:

| Column | Value |
| ------ | ----- |
| `A` id | `GA037`, `GA038`, ... (existing) |
| `B` label | Human name (existing) |
| ... | ... existing columns ... |
| `L` (new) `processUrl` | `https://api.voyagersearch.com/ospd/processes/{term}` |

For the 3 umbrella concepts (`retrieval`, `enrichment`, `orchestration` — labels TBC), `processUrl` stays empty since they name families, not endpoints.

## C2 — JSON-LD dump (post-deploy — or now with planned URLs)

`npm run register:jsonld` builds a self-contained JSON-LD document consumable by an LD-client without any remote resolution. Two input modes:

```bash
# From a JSON file exported from the sheet
npm run register:jsonld -- --file rows.json --out register.jsonld

# From stdin
cat rows.json | npm run register:jsonld -- --stdin > register.jsonld
```

`rows.json` is an array of register-row objects — see [`docs/examples/register-rows.example.json`](examples/register-rows.example.json) for the shape.

**Output shape**: `skos:ConceptScheme` with one `skos:Concept` per row. When `processUrl` is present on a row, the concept gets a `voy:hasProcessProfile` pointing at the OGC API-Processes endpoint. When absent, the generator fills a *planned* URL from the URI scheme above (marked `voy:status: "planned"`) so early consumers can see the intent.

## Post-deploy handoff to Nick

Once C1 + C2 land, the handoff email is:

- Link to the sheet with the `processUrl` column populated
- `register.jsonld` attachment (or a stable URL served from the D120 service)
- A short list of live process endpoints Nick can probe with his LD-client

The email thread this closes back into: Sina / Rob / Nick's OSPD Register discussion. Draft was staged in the earlier session — refresh from that thread when ready.
