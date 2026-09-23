# D110 ↔ D120 Federation

Voyager's OSPD contribution has two paired deliverables:

- **D110** — Definitions Register: 13 rows (10 activity types + 3 umbrella concepts) contributed to the shared OSPD sheet [`1myNRKLghCCaTMaoFjfZjqK6D6MYFqtIn8lxUAIkXBjc`](https://docs.google.com/spreadsheets/d/1myNRKLghCCaTMaoFjfZjqK6D6MYFqtIn8lxUAIkXBjc), tabs *Definitions Register!A41:L53* + *Demo Definition Use!A12:H18*.
- **D120** — Processes Profiler: this repo. Every activity type in the register has a matching `POST /processes/{term}/execution` endpoint here.

This document describes how the two are wired together at the discoverability layer.

## The register, published

The 13-row register is committed here as JSON-LD, conforming to OSC's [`ogc.model.registered-item.activity-type`](https://github.com/ogcincubator/registered-item-model/tree/master/_sources/activity-type) profile (an ISO 19135:2026 shape published as a Building Block).

Pull it directly — matches the same pattern the OSC bblocks registers publish:

```bash
curl -sS https://raw.githubusercontent.com/voyagersearch/voyager-processes-profiler/dev/docs/register/voyager-geoprocessing-activities.jsonld > voyager-register.jsonld
```

Local source: [`docs/register/voyager-geoprocessing-activities.jsonld`](register/voyager-geoprocessing-activities.jsonld).

## SHACL validation loop

The register is validated against the `activity-type` profile's SHACL shapes on every run of `npm run register:validate`. The script fetches shapes + ontology from the RIM repo on first run (cached under `scripts/.shacl-cache/`) and pipes them into `pyshacl`.

```bash
# One-time: install the SHACL runner
pipx install pyshacl        # recommended (isolates deps)
# or:  pip install --user pyshacl

# Validate the committed JSON-LD
npm run register:validate

# Validate a different file
npm run register:validate -- --data path/to/register.jsonld

# Force re-fetch of remote shapes/ontology
npm run register:validate -- --refresh
```

Expected output on the committed dump:

```
validating docs/register/voyager-geoprocessing-activities.jsonld
Validation Report
Conforms: True
```

Any change to `scripts/generate-register-jsonld.mjs` or to the row inputs should be re-validated before committing.

## URI scheme (locked per plan)

Both deliverables share `api.voyagersearch.com/ospd/...` as their base so cross-links are one field, not full URLs:

```
Register concept:  http://ospd/demo/{term}                          (in the JSON-LD)
Process endpoint:  https://api.voyagersearch.com/ospd/processes/{term}
Process execute:   https://api.voyagersearch.com/ospd/processes/{term}/execution
Sidecar PROV:      https://api.voyagersearch.com/ospd/prov/activity/{uuid}
```

`{term}` is the machine-readable slug — `retrieve`, `rank`, `generate`, `geotag`, and so on. It matches the D100 12-type activity enum plus D120's own `rank` and the composite `rag-workflow`.

Each item in the JSON-LD carries a `voy:hasProcessProfile` link to its running D120 process (the 3 umbrella concepts don't have endpoints — they're super-classes, not runnable).

## Regenerating the JSON-LD from the sheet

The 13 register rows are captured in [`docs/examples/voyager-register-rows.json`](examples/voyager-register-rows.json). To regenerate the JSON-LD after editing rows:

```bash
npm run register:jsonld -- --file docs/examples/voyager-register-rows.json --out docs/register/voyager-geoprocessing-activities.jsonld
npm run register:validate
```

If the row set changes upstream in the Google Sheet, refresh `voyager-register-rows.json` from *Definitions Register!A41:L53* before regenerating.

## Shape summary

Each of the 13 rows becomes an `acttype:ActivityType` **and** `owl:Class` **and** `rdfs:subClassOf prov:Activity` — the RIM design where the register item and the class are one resource.

- **10 specific rows** subclass their umbrella (e.g. `Retrieve rdfs:subClassOf <http://ospd/demo/retrieval-augmented-generation>`).
- **3 umbrella rows** subclass `prov:Activity` directly.
- All 13 carry the SHACL-required RIM fields: `rim:inRegister`, `rim:itemClass acttype:activityTypeItemClass`, `rim:objectIdentifier`, `rim:validityStatus rim:valid`, `rim:publicationStatus rim:published`.
- The single `rim:Register` node names `rim:registerManager` and `rim:registerOwner` (both currently Voyager Search).

## Post-deploy handoff to Nick

Once the D120 URLs are publicly reachable (AWS SG / ALB open — see [ARCHITECTURE.md](ARCHITECTURE.md) for the ingress story), the handoff email is:

- Curl snippet above → the JSON-LD
- `npm run register:validate` for reproducible SHACL validation
- A short list of live process endpoints Nick can probe with his LD-client

The email thread this closes back into: Sina / Rob / Nick's OSPD Register discussion.
