# Architecture + Terminology Cheatsheet

> The three-minute orientation for when you come back to this project after a few weeks. Covers who talks to whom, what the acronyms mean, and where things live.

## The 30-second version

Voyager is contributing three things to the OSPD program (Open Standards for Process Description — an OGC incubator effort under the OSC umbrella):

- **D100** — an emitter that produces PROV records from real Voyager work (RAG queries, HQ pipeline steps). Lives in `voyager-prov-ts` (Node) + `voyager-prov-py` (Python) + JS embedded in HQ pipelines. **Status: live in production, emitting to `hq.demo.voyagersearch.com`.**
- **D110** — a definitions register: a controlled vocabulary of the activity types D100 emits, published as a Google Sheet + eventually as JSON-LD. **Status: 13 rows contributed to the shared OSPD sheet.**
- **D120** — an OGC API-Processes 1.0 HTTP surface that lets external clients drive D100's chain by name (`POST /processes/retrieve/execution`) and get back the PROV envelope they'd get if they were the one causing the emission. **This repo.** Status: deployed to `ec2-18-224-65-160:4601`, all 14 processes live.

Everything else in this doc is elaboration.

## Terminology

Grouped by domain so you can scan for the concept you forgot.

### OGC + OSC standards

- **OGC** — Open Geospatial Consortium. Publishes geospatial standards.
- **OSC** — Open Science / Sustainable Cities-and-Communities / etc. incubator effort inside OGC. Runs `github.com/ogcincubator/*` repos.
- **OGC API - Processes 1.0** — the spec D120 implements. Defines `/processes`, `/processes/{id}`, `/processes/{id}/execution`, `/jobs/{jobId}`, `/jobs/{jobId}/results`. See [docs.ogc.org/is/18-062r2](https://docs.ogc.org/is/18-062r2/18-062r2.html).
- **bblock** ("building block") — OSC's unit of specification. A bblock is a tiny package (a `bblock.json` + a schema fragment + optional description) that says "here's a constraint layered on top of an existing spec." Bblocks compose via `dependsOn`. Our IPT profile is a bblock; so is the workflow profile.
- **IPT profile** (`ogc.osc.api-profiles.processes.ipt.api`) — bblock that adds three constraints on top of vanilla OGC API-Processes: client MUST be able to nominate an IRI for the `prov:Activity` (`activity_id`), the `prov:Agent` (`agent_id`), and the `prov:Entity` result (`result_id`). D120 conforms.
- **Workflow profile** (`ogc.osc.api-profiles.processes.workflow`) — bblock composing IPT + Application Package (CWL). D120 conforms at the descriptor level via `rag-workflow`; a real CWL runtime is v0.3.
- **OSPD profile** (`ogc.osc.api-profiles.processes.ospd`) — umbrella bblock combining workflow + geodcat-stac-earthcode.
- **CWL** — Common Workflow Language. YAML shape for describing multi-step workflows. The workflow bblock composes with CWL as its "how do steps chain" mechanism.

### PROV

- **PROV** — W3C standard for provenance. The core triple is (Activity, Agent, Entity): an Activity was run by an Agent and generated/used Entities. See [www.w3.org/ns/prov](https://www.w3.org/ns/prov).
- **prov:Activity** — a thing that happened at a point in time. In D120: one execution of one process is one Activity.
- **prov:Agent** — the actor that did the Activity. For D120: the tool signature (e.g. "the RAG retriever v1").
- **prov:Entity** — the input(s) and output(s) of an Activity. For D120: the retrieved doc set, the ranked list, the generated answer.
- **`activity_id` / `agent_id` / `result_id`** — the three IRIs the IPT profile requires the client to nominate. D120 echoes them back verbatim in the response envelope so client-side systems can correlate.

### The three deliverables

- **D100 — Workflow Profiler** — the emitter. Every RAG chain step + every FAS enrichment pipeline step produces a `prov:Activity` sidecar JSON that gets swept into HQ Solr. Code lives in:
  - `voyager-prov-ts/src/emit.ts` (Node)
  - `voyager-prov-ts/src/hq-runjs/prov-emit.js` (HQ runJavaScript pipeline steps)
  - `voyager-prov-py/src/voyager_prov/emit.py` (Python mirror)
- **D110 — Definitions Register** — the vocabulary. A Google Sheet at `1myNRKLghCCaTMaoFjfZjqK6D6MYFqtIn8lxUAIkXBjc`, tabs *Definitions Register* (13 activity type rows GA037-GA049) + *Demo Definition Use* (example uses). JSON-LD dump generator lives here at `scripts/generate-register-jsonld.mjs`.
- **D120 — Processes Profiler** — the HTTP surface. This repo. 14 OGC API-Processes endpoints (retrieve, rank, generate + 10 playback + rag-workflow composite).

### D120-specific

- **Real-execute process** — the handler runs the underlying operation live against HQ + RAG. In v0.2 that's `retrieve` (HQ search), `rank` (HTTP rerank / score-sort), `generate` (RAG /ask proxy).
- **Playback process** — the handler doesn't re-run the underlying operation; instead it queries Solr for existing PROV records matching the requested subject + activity type, and returns them as if D120 had just executed. On-the-wire indistinguishable from real-execute. v0.2 ships 10 playback processes for Layer 1 (FAS ops) + Layer 2 (RAG ingest) activities where HQ has no callable standalone endpoint yet.
- **Composite process** — one process description that walks multiple sub-handlers as a workflow. `rag-workflow` does retrieve → rank → generate as a single call; each sub-step emits its own PROV; the composite's `outputs.chain_provenance` names the child activity IRIs.
- **Toggle** — per-process on/off + maturity + IPT compliance mode. Configured in `src/processes/toggle.json`, overridable via `PROCESSES_TOGGLE_OVERRIDE` env. The negotiation surface for later HQ 26.x product bake-in.
- **IPT compliance modes**:
  - `strict` — request MUST include activity_id + agent_id + result_id or 400.
  - `permissive` — missing IRIs get minted server-side (default in v0.2).
- **Sidecar** — the `SolrProvDoc`-shaped JSON that D120 writes to HQ's file API after every successful execution. Gets swept into Solr `main` by a folder repo (see below).
- **`?provenance=reference`** — query param on POST /processes/{id}/execution. Instead of inlining the full PROV block in the response, returns `{@id, href}` pointing at `/prov/activity/{uuid}`. Both forms conform to the IPT results bblock.

### HQ + Solr

- **HQ (Voyager HQ 3.x)** — Voyager's central control-plane server. Owns Solr collections, folder repos, pipelines, agents, security. Reachable at `https://hq.demo.voyagersearch.com` (hosted) or `http://localhost:4000` (local dev).
- **Solr `main`** — the primary index. Holds content docs AND PROV records side by side (same collection, different fields).
- **Folder repo** — an HQ construct that watches a filesystem path and indexes every file it finds into Solr. Repo `r1a02cbdfdbe` on the hosted HQ watches `/hq/home/py/test_data/prov/` — that's the path D120 (and D100) write sidecars into.
- **Pipeline** — an ordered list of steps HQ applies to each doc during indexing. The FAS-enrichment pipeline `demo-fas-showcase` (p19f480b9b90) has a tail-step that emits PROV via `voyager-prov-ts/src/hq-runjs/prov-emit.js`.
- **`prov_id`, `prov_activityType`, `prov_agent`, `prov_used`, `prov_generated`, `prov_startedAt`, `prov_endedAt`, `prov_jsonld`** — the Solr fields on a PROV record.
- **Facet-groupability** — being able to group Solr records by `prov_activityType`. Requires all emitters to use the same URI value for the same activity type — hence the register-map.

### URI namespaces

Two live in Solr today, both intentional:

- **`https://voyager.ogc/prov/activity/{slug}`** — Voyager-internal namespace, the default (`VOYAGER_ACTIVITY_NS` in `voyager-prov-ts`).
- **`https://d110.ogc.org/registers/prov-activity/{slug}`** — the D110 register's canonical URIs. Activated per-deploy via the `PROV_REGISTER_MAP` env var, which points at a JSON file mapping activity-type slugs to register URIs.
- **`PROV_REGISTER_MAP`** — env var honored by both `voyager-prov-ts` and D120's sidecar-writer. Accepts a file path or an inline JSON literal. Missing/malformed → silent fallback to the internal namespace (emissions never fail on register-load).

## Repo map

| Repo | Language | Purpose |
| ---- | -------- | ------- |
| `voyager-prov-ts` | TS | Canonical PROV emitter — types, `emit()`, `activityTypeURI()`, the remap. Also carries the HQ runJS emitter (`src/hq-runjs/prov-emit.js`) inlined into pipelines. |
| `voyager-prov-py` | Python | Python mirror of `voyager-prov-ts`. Same shapes, same tests. Used by Python-side FAS ingest tools. |
| `voyager-hq-3.x-mcp` | TS | MCP server wrapping the HQ 3.x REST API. Cookie-session auth, retry logic. D120 borrows its auth pattern. |
| `voyager-mastra-full-rag` | TS | The RAG service (Hono + Mastra + MCP + embedder + Ollama). Runs at `voyager-rag-demo-rag-1` on the demo box, port 4500. Emits PROV via `voyager-prov-ts`. **This is what powers the fas-chat demo at https://fas-chat.demo.voyagersearch.com/.** |
| `voyager-processes-profiler` | TS | **This repo.** D120. OGC API-Processes surface. Deploys at `ec2-18-224-65-160:4601`. |

## Runtime map on the demo EC2

```
Host: ec2-18-224-65-160.us-east-2.compute.amazonaws.com

Docker network: voyager-rag-demo_default
├── voyager-rag-demo-rag-1        (alias: rag)      4500/tcp (internal only)
├── voyager-rag-demo-embedder-1                      8504/tcp
├── voyager-rag-demo-ollama-1                       11434/tcp
├── voyager-rag-demo-chat-1                         :4600     (fas-chat UI)
└── voyager-processes-profiler    (D120, joined)    :4601     ← new

External:
├── https://hq.demo.voyagersearch.com               (HQ + Solr, hosted)
└── https://fas-chat.demo.voyagersearch.com/        (chat UI → RAG service)

Filesystem:
├── /home/ubuntu/voyager-prov-ts                    (sibling for file:-dep)
├── /home/ubuntu/voyager-mastra-full-rag
├── /home/ubuntu/voyager-processes-profiler         ← new
└── ...
```

Note: HQ + Solr are NOT on the docker host — they're the hosted service at `hq.demo.voyagersearch.com`. Both the RAG service and D120 reach it via that HTTPS URL.

## Data flow — the whole loop

Following a single D120 execution end-to-end:

```
 CLIENT
   │
   │  POST /processes/retrieve/execution
   │  Content-Type: application/json
   │  { "activity_id": "urn:client:run:42",
   │    "inputs": {"query":"wildfire","top_k":10} }
   │
   ▼
 D120  (voyager-processes-profiler on :4601)
   │
   │ 1. execution.ts route parses query, checks toggle
   │ 2. normaliseIptRequest — mints missing IRIs (permissive mode)
   │ 3. retrieveHandler → POST hq.demo/api/search/main
   │
   │                                    ┌───────────────────┐
   │                                    │  HQ (hosted)      │
   │                                    │  hq.demo.voyager… │
   ├─── search request ─────────────────▶  Solr `main`     │
   │                                    │                   │
   │◀── {docs: [...]} ──────────────────┤                   │
   │                                    └───────────────────┘
   │
   │ 4. wrapWithProvenance — builds prov:Activity block,
   │    stores in in-memory map keyed by uuid
   │ 5. emitSidecarInBackground (fire-and-forget)
   │       │
   │       │ POST hq.demo/api/files/edit/py?path=test_data/prov/{shard}/{uuid}.json
   │       │  (multipart, cookie-auth)
   │       ▼
   │      HQ file API writes to disk
   │
   │ 6. return { outputs: { candidates: [...], provenance: {...} } }
   │
   ▼
 CLIENT gets response with inline prov:Activity
                             │
 ───────────────────────────  eventually  ─────────────────────────────
                             │
   HQ folder repo r1a02cbdfdbe scans /hq/home/py/test_data/prov/
   picks up new sidecar file → runs pipeline p1a02cbdfdbd → writes to Solr `main`
                             │
                             ▼
   D120 execution is now discoverable in Solr:
     q=prov_id:"urn:client:run:42"
     q=prov_activityType:"https://voyager.ogc/prov/activity/retrieve"
```

The scan is delta-based; sweeps run on a schedule OR when someone PUTs `/api/repos/{id}/index?delta=true`. Latency: seconds to minutes depending on backlog.

## Deployable map — what runs where

| Deliverable | Where the code lives | Where it runs | How to reach it |
| ----------- | -------------------- | ------------- | --------------- |
| D100 (Node emitter) | `voyager-prov-ts` | Inside `voyager-mastra-full-rag` runtime (as a `file:` dep) | Via the RAG service's `/ask?prov=true` |
| D100 (HQ runJS emitter) | `voyager-prov-ts/src/hq-runjs/prov-emit.js` | Inlined into HQ pipeline `demo-fas-showcase` (p19f480b9b90) as a tail runJavaScript step | Auto-fires on every doc indexed through that pipeline |
| D100 (Python emitter) | `voyager-prov-py` | Wherever Python FAS ingest tools run | N/A directly |
| D110 register | Google Sheet `1myNRKL…AkXBjc` | Google Sheets | The sheet URL |
| D110 JSON-LD dump | `voyager-processes-profiler/scripts/generate-register-jsonld.mjs` | Ad-hoc CLI | `npm run register:jsonld -- --file rows.json` |
| D120 | `voyager-processes-profiler` | Docker container on demo EC2 | `http://ec2-18-224-65-160.us-east-2.compute.amazonaws.com:4601/` |

## Common trip-ups

- **"Where's the D110 register itself?"** — the Google Sheet at [1myNRKL…AkXBjc](https://docs.google.com/spreadsheets/d/1myNRKLghCCaTMaoFjfZjqK6D6MYFqtIn8lxUAIkXBjc/edit). Voyager's rows are 41-53 on the *Definitions Register* tab. Not in Solr, not in any repo — the sheet is the source of truth for now, and `npm run register:jsonld` produces a machine-readable dump from it.
- **"Where do the D100 sidecar files actually land?"** — on the HQ filesystem at `/hq/home/py/test_data/prov/{shard}/{uuid}.json`. Written via HQ's `POST /api/files/edit/py?path=…` endpoint. Swept into Solr by folder repo `r1a02cbdfdbe`.
- **"Why does one facet bucket have URI `voyager.ogc/...` and another have `d110.ogc.org/...`?"** — `PROV_REGISTER_MAP` env var. When set, emissions remap through the D110 register URIs. When unset, they land in the Voyager-internal namespace. Currently the hosted HQ's runJS emitter has SOME activities remapped (geotag, classify-commodity) and others not — that's the split you see in Solr. D120 honors the same env var (as of PR #12).
- **"Playback vs real-execute — is the response different?"** — No. Same shape on the wire. The process description says `[Strategy: PLAYBACK]` in its abstract so a caller who reads it knows. Response envelope carries `strategy: "playback"`.
- **"Which HQ am I talking to?"** — check `HQ_BASE_URL` in whatever env is loaded. On the demo EC2 both the RAG service and D120 point at `https://hq.demo.voyagersearch.com`. HQ is NOT running on the docker host (this tripped up the first deploy — `host.docker.internal:4000` returns nothing).
- **"Why does D120 have `rank` and `rag-workflow` when they're not in the D100 activity enum?"** — D120's process catalog is a strict superset of D100's activity types. `rank` (HTTP rerank) and `rag-workflow` (composite) are useful process-shapes that D100 doesn't model as separate activities. `voyager-prov-ts`'s `ActivityType` union type doesn't include them — that's why D120's sidecar-writer composes URIs directly via `register-map.ts` instead of calling `voyager-prov-ts`'s `activityTypeURI()`.
- **"OSPD vs FGDC vs Darcee's meeting"** — decoupled. See [[ospd-framing]] memory: OSPD is a discoverability + downstream-influence learning exercise; FGDC/Darcee work is a separate revenue path (CRO signed a 1yr NSDI contract 2026-09-22). Overlap in the Voyager tech that powers both, but slippage in one doesn't affect the other.
- **"Where's the deploy?"** — `/home/ubuntu/voyager-processes-profiler/` on `ec2-18-224-65-160.us-east-2.compute.amazonaws.com`. Deploy pattern is: `rsync` from local → `cd deploy` → `docker compose -f docker-compose.demo.yml --env-file processes.env up -d --build`. Uses `additional_contexts:prov` to bake `voyager-prov-ts` into the image at build time.

## Standards references

- [OGC API - Processes 1.0 spec](https://docs.ogc.org/is/18-062r2/18-062r2.html)
- [OSC IPT profile source](https://github.com/ogcincubator/bblocks-openscience/tree/master/_sources/api-profiles/processes/ipt)
- [OSC workflow profile source](https://github.com/ogcincubator/bblocks-openscience/tree/master/_sources/api-profiles/processes/workflow)
- [OSC OSPD profile source](https://github.com/ogcincubator/bblocks-openscience/tree/master/_sources/api-profiles/processes/ospd)
- [W3C PROV](https://www.w3.org/ns/prov)
- [CWL 1.2](https://www.commonwl.org/v1.2/)

## Plan file trail (chronological)

- `~/.claude/plans/d120-processes-profiler.md` — original D120 skeleton design + decisions locked
- `~/.claude/plans/d120-v0.2-scope.md` — v0.2 scope + shipped items + Phase 5B post-deploy backlog
- `~/.claude/projects/…/memory/d100-layer1-fas.md` — D100 Layer-1 FAS enrichment addendum (12-type activity enum, HQ tail-step emitter, smoke test results)
- `~/.claude/projects/…/memory/ospd-framing.md` — OSPD is a learning exercise, decoupled from FGDC revenue
- `~/.claude/projects/…/memory/nsdi-1yr-contract.md` — CRO signed 1yr NSDI contract 2026-09-22
