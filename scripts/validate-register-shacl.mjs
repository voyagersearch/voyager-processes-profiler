#!/usr/bin/env node
/**
 * SHACL-validate a register JSON-LD file against the OSC
 * `ogc.model.registered-item.activity-type` profile.
 *
 * Fetches shapes + ontologies from the registered-item-model repo on
 * first run (or --refresh), caches them under scripts/.shacl-cache/, then
 * calls `pyshacl` to validate.
 *
 * Requires pyshacl installed and on PATH. Install:
 *   pipx install pyshacl        (recommended, isolates deps)
 *   pip install --user pyshacl  (user site-packages)
 *
 * Usage:
 *   npm run register:validate
 *   npm run register:validate -- --data docs/register/voyager-geoprocessing-activities.jsonld
 *   npm run register:validate -- --refresh   # re-fetch shapes/ontology
 *
 * Exit code mirrors pyshacl:
 *   0 → Conforms: True
 *   1 → Conforms: False (violations printed)
 *   2 → setup problem (pyshacl missing, fetch failed, etc.)
 */

import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

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

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CACHE_DIR = join(HERE, ".shacl-cache");
const DEFAULT_DATA = join(
  REPO_ROOT,
  "docs/register/voyager-geoprocessing-activities.jsonld"
);

const RIM_RAW =
  "https://raw.githubusercontent.com/ogcincubator/registered-item-model/master/_sources";
const REMOTE_FILES = [
  { url: `${RIM_RAW}/activity-type/shapes.shacl`, local: "act.shapes.shacl" },
  { url: `${RIM_RAW}/activity-type/ontology.ttl`, local: "act.ontology.ttl" },
  { url: `${RIM_RAW}/core-ontology/ontology.ttl`, local: "core.ontology.ttl" },
  { url: `${RIM_RAW}/core-ontology/shapes.shacl`, local: "core.shapes.shacl" },
];

async function ensureCache(refresh) {
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const f of REMOTE_FILES) {
    const path = join(CACHE_DIR, f.local);
    if (!refresh && existsSync(path)) continue;
    const res = await fetch(f.url);
    if (!res.ok) {
      console.error(`fetch ${f.url} → HTTP ${res.status}`);
      exit(2);
    }
    const text = await res.text();
    writeFileSync(path, text, "utf8");
    console.error(`cached ${f.local} (${text.length} bytes)`);
  }
}

function runPyshacl(dataPath) {
  const cmd = "pyshacl";
  const cliArgs = [
    "-s", join(CACHE_DIR, "act.shapes.shacl"),
    "-sf", "turtle",
    "-e", join(CACHE_DIR, "act.ontology.ttl"),
    "-e", join(CACHE_DIR, "core.ontology.ttl"),
    "-e", join(CACHE_DIR, "core.shapes.shacl"),
    "-ef", "turtle",
    "-df", "json-ld",
    "--inference", "rdfs",
    dataPath,
  ];
  const r = spawnSync(cmd, cliArgs, { stdio: "inherit" });
  if (r.error && r.error.code === "ENOENT") {
    console.error("pyshacl not on PATH — install via `pip install --user pyshacl` or `pipx install pyshacl`.");
    exit(2);
  }
  exit(r.status ?? 1);
}

async function main() {
  const dataPath = resolve(args.get("data") ?? DEFAULT_DATA);
  await ensureCache(Boolean(args.get("refresh")));
  console.error(`validating ${dataPath}`);
  runPyshacl(dataPath);
}

main().catch((err) => {
  console.error(err);
  exit(2);
});
