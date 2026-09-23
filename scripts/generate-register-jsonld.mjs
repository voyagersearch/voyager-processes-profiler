#!/usr/bin/env node
/**
 * Turn the OSPD Definitions Register sheet rows (Voyager's 13-entry
 * contribution — 10 activity types + 3 umbrella concepts) into a JSON-LD
 * dump ready for direct import into the OSC-side register or for Nick's
 * LD-client testing.
 *
 * Two input modes:
 *
 *   node scripts/generate-register-jsonld.mjs --file rows.json
 *       Reads a local JSON file with the 13 rows already extracted from
 *       the sheet. Use this once Alex has exported the sheet range as
 *       JSON — offline, deterministic, no Google auth needed.
 *
 *   node scripts/generate-register-jsonld.mjs --stdin < rows.json
 *       Same, from stdin.
 *
 * Row shape expected (each row is a Definitions Register entry):
 *   {
 *     "id": "GA037",               // register id
 *     "label": "Retrieve",         // human-readable name
 *     "term": "retrieve",          // machine-readable slug (matches D120 process id)
 *     "description": "...",
 *     "isDefinedBy": "https://...", // canonical URL for the concept
 *     "processUrl": "https://api.voyagersearch.com/ospd/processes/retrieve"  // OPTIONAL — Phase 5B fills this
 *   }
 *
 * Output: JSON-LD document with @context + a graph of skos:Concept nodes,
 * each pointing at the corresponding D120 process endpoint via
 * `voy:hasProcessProfile` when processUrl is present.
 *
 * Writes to stdout by default; pass --out <path> to write to a file.
 *
 * The output shape matches what Nick asked for in the OSPD email thread:
 * a self-contained JSON-LD file consumable by an LD-client without any
 * remote resolution.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit, stdin } from "node:process";

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

const REGISTER_BASE =
  args.get("register-base") ?? "https://api.voyagersearch.com/ospd/register";
const PROCESSES_BASE =
  args.get("processes-base") ?? "https://api.voyagersearch.com/ospd/processes";

function readInput() {
  if (args.get("file")) return readFileSync(args.get("file"), "utf8");
  if (args.get("stdin")) {
    return new Promise((resolve) => {
      const chunks = [];
      stdin.on("data", (c) => chunks.push(c));
      stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }
  console.error(
    "Usage: node scripts/generate-register-jsonld.mjs (--file rows.json | --stdin)"
  );
  exit(2);
}

function buildConcept(row) {
  const term = row.term ?? row.label?.toLowerCase().replace(/\s+/g, "-");
  const conceptIri = row.isDefinedBy ?? `${REGISTER_BASE}/activities/${term}`;
  const node = {
    "@id": conceptIri,
    "@type": "skos:Concept",
    "skos:notation": row.id,
    "skos:prefLabel": row.label,
    "dct:description": row.description ?? "",
    "voy:term": term,
  };
  if (row.processUrl) {
    node["voy:hasProcessProfile"] = {
      "@id": row.processUrl,
      "@type": "ogcapi:Process",
    };
  } else if (term) {
    // Forward-looking process URL when the sheet hasn't filled it yet.
    node["voy:hasProcessProfile"] = {
      "@id": `${PROCESSES_BASE}/${term}`,
      "@type": "ogcapi:Process",
      "voy:status": "planned",
    };
  }
  return node;
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
    console.error("Input must be a JSON array of register rows");
    exit(1);
  }

  const doc = {
    "@context": {
      "@vocab": "https://voyagersearch.com/ns/ospd/",
      voy: "https://voyagersearch.com/ns/ospd/",
      skos: "http://www.w3.org/2004/02/skos/core#",
      dct: "http://purl.org/dc/terms/",
      ogcapi: "http://www.opengis.net/def/ogcapi/",
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
    "@id": REGISTER_BASE,
    "@type": "skos:ConceptScheme",
    "skos:prefLabel": "Voyager OSPD Register — Definitions",
    "dct:issued": new Date().toISOString().slice(0, 10),
    "dct:contributor": "Voyager Search",
    "skos:hasTopConcept": rows.map((r) => buildConcept(r)),
  };

  const out = JSON.stringify(doc, null, 2);
  if (args.get("out")) {
    writeFileSync(args.get("out"), out + "\n", "utf8");
    console.error(`wrote ${args.get("out")} (${out.length} bytes)`);
  } else {
    process.stdout.write(out + "\n");
  }
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
