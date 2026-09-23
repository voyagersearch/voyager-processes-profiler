#!/usr/bin/env node
/**
 * Emit a JSON-LD document conforming to
 *   ogc.model.registered-item.activity-type
 * (a profile of the Registered Item Model, itself an ISO 19135:2026 shape).
 *
 * Each register row becomes an `acttype:ActivityType`, which is simultaneously
 *   - a `rim:RegisterItem` (managed under the register with an identifier +
 *     lifecycle status), and
 *   - an `owl:Class` declared `rdfs:subClassOf prov:Activity` — so an
 *     emitted activity can be typed directly with the registered term.
 *
 * The three umbrella rows (Data Acquisition, Text Metadata Enrichment,
 * Retrieval-Augmented Generation) are themselves activity types — they are
 * the super-classes the 10 specific types specialise via `rdfs:subClassOf`.
 * The RIM allows this: `acttype:ActivityType` is a class, and one activity
 * type can subclass another (both are sub-classes of `prov:Activity`).
 *
 * SHACL validation:
 *   npm run register:jsonld -- --file docs/examples/voyager-register-rows.json --out register.jsonld
 *   # then validate the output against
 *   # https://raw.githubusercontent.com/ogcincubator/registered-item-model/master/_sources/activity-type/shapes.shacl
 *
 * Usage:
 *   node scripts/generate-register-jsonld.mjs --file rows.json [--out register.jsonld]
 *   cat rows.json | node scripts/generate-register-jsonld.mjs --stdin
 */

import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit, stdin } from "node:process";

// ── CLI ──────────────────────────────────────────────────────────────────
const args = new Map();
for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, true);
    }
  }
}

// The register itself + the per-item base. Kept overridable so the same
// generator can emit a "planned URLs" preview or the live production URIs.
const REGISTER_URI =
  args.get("register-uri") ?? "http://ospd/demo/register/voyager-geoprocessing-activities";
const REGISTER_TITLE =
  args.get("register-title") ?? "Voyager Geoprocessing Activities (OSPD Demo)";
const REGISTER_DESCRIPTION =
  args.get("register-description") ??
  "Voyager Search's contribution to the OSPD Definitions Register: the 13 activity types (10 pipeline steps + 3 umbrella categories) emitted by the Voyager RAG chain and HQ-side FAS enrichment pipelines, published as a profile of the OSC Registered Item Model.";
const CUSTODIAN_URI =
  args.get("custodian-uri") ?? "http://ospd/demo/agents/voyager-search";
const PROCESSES_BASE =
  args.get("processes-base") ?? "https://api.voyagersearch.com/ospd/processes";

// ── Input ────────────────────────────────────────────────────────────────
async function readInput() {
  if (args.get("file")) return readFileSync(args.get("file"), "utf8");
  if (args.get("stdin")) {
    return new Promise((resolve) => {
      const chunks = [];
      stdin.on("data", (c) => chunks.push(c));
      stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }
  console.error(
    "Usage: node scripts/generate-register-jsonld.mjs (--file rows.json | --stdin) [--out register.jsonld]"
  );
  exit(2);
}

// ── Term URIs for the broader-column umbrella labels ─────────────────────
// The sheet's "Broader" column names an umbrella by label; we resolve that to
// the corresponding umbrella row's URI so rdfs:subClassOf refers to the
// actually-registered class.
function buildLabelToUriIndex(rows) {
  const index = new Map();
  for (const r of rows) {
    if (r.label && r.isDefinedBy) index.set(r.label, r.isDefinedBy);
  }
  return index;
}

function resolveRelated(labels, index) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => index.get(l))
    .filter((v) => typeof v === "string" && v.length > 0)
    .map((iri) => ({ "@id": iri }));
}

// ── Emitter ──────────────────────────────────────────────────────────────
function buildRegisterItem(row, index) {
  const item = {
    "@id": row.isDefinedBy,
    "@type": ["acttype:ActivityType", "owl:Class"],
    "rdfs:subClassOf": row.broader
      ? { "@id": index.get(row.broader) ?? row.broader }
      : { "@id": "prov:Activity" },
    "rdfs:label": row.label,
    "dct:title": row.label,
    "dct:description": row.description ?? "",
    "rim:inRegister": { "@id": REGISTER_URI },
    "rim:itemClass": { "@id": "acttype:activityTypeItemClass" },
    "rim:objectIdentifier": {
      "@value": row.isDefinedBy,
      "@type": "xsd:anyURI",
    },
    "rim:validityStatus": { "@id": "rim:valid" },
    "rim:publicationStatus": { "@id": "rim:published" },
    "skos:notation": row.id,
  };
  // Umbrella rows subclass prov:Activity directly (they are themselves
  // super-classes for the specific rows). Overriding here keeps the
  // rdfs:subClassOf branch above from resolving null → prov:Activity twice.
  if (row.umbrella) {
    item["rdfs:subClassOf"] = { "@id": "prov:Activity" };
  }
  if (Array.isArray(row.related) && row.related.length > 0) {
    item["skos:related"] = resolveRelated(row.related, index);
  }
  if (row.sourceOfDefn) {
    item["dct:source"] = { "@id": row.sourceOfDefn };
  }
  if (row.container) {
    item["dct:isPartOf"] = row.container;
  }
  if (row.version) {
    item["owl:versionInfo"] = row.version;
  }
  if (row.custodian) {
    item["dct:creator"] = { "@id": CUSTODIAN_URI, "rdfs:label": row.custodian };
  }
  if (row.contact) {
    item["dct:contributor"] = row.contact;
  }
  // Cross-link: for the 10 specific types, there is a running D120 process
  // at PROCESSES_BASE/{term}. Umbrellas don't have their own endpoint.
  if (!row.umbrella && row.term) {
    item["voy:hasProcessProfile"] = {
      "@id": `${PROCESSES_BASE}/${row.term}`,
      "@type": "ogcapi:Process",
    };
  }
  return item;
}

function buildRegister(_rows) {
  // Note: rim:itemClass is a property of items, NOT the register itself
  // (SHACL enforces this — any resource carrying rim:itemClass acttype:
  // activityTypeItemClass must be an acttype:ActivityType). Membership is
  // expressed by items pointing at the register via rim:inRegister; the
  // core ontology has no rim:hasItem inverse.
  return {
    "@id": REGISTER_URI,
    "@type": "rim:Register",
    "dct:title": REGISTER_TITLE,
    "dct:description": REGISTER_DESCRIPTION,
    "dct:issued": new Date().toISOString().slice(0, 10),
    "dct:creator": { "@id": CUSTODIAN_URI, "rdfs:label": "Voyager Search" },
    "rim:registerManager": { "@id": CUSTODIAN_URI },
    "rim:registerOwner": { "@id": CUSTODIAN_URI },
  };
}

async function main() {
  const raw = await readInput();
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch (err) {
    console.error("Input is not valid JSON:", err.message);
    exit(1);
  }
  if (!Array.isArray(rows)) {
    console.error("Input must be a JSON array of register rows.");
    exit(1);
  }

  const index = buildLabelToUriIndex(rows);

  const doc = {
    "@context": {
      "@vocab": "https://voyagersearch.com/ns/ospd/",
      voy: "https://voyagersearch.com/ns/ospd/",
      rim: "https://w3id.org/ogc/rim/",
      acttype: "https://w3id.org/ogc/rim/activity-type/",
      prov: "http://www.w3.org/ns/prov#",
      skos: "http://www.w3.org/2004/02/skos/core#",
      dct: "http://purl.org/dc/terms/",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      owl: "http://www.w3.org/2002/07/owl#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      ogcapi: "http://www.opengis.net/def/ogcapi/",
    },
    "@graph": [buildRegister(rows), ...rows.map((r) => buildRegisterItem(r, index))],
  };

  const out = JSON.stringify(doc, null, 2);
  if (args.get("out")) {
    writeFileSync(args.get("out"), out + "\n", "utf8");
    console.error(`wrote ${args.get("out")} (${out.length} bytes, ${rows.length} items)`);
  } else {
    process.stdout.write(out + "\n");
  }
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
