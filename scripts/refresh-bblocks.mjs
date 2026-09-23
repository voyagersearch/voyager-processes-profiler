#!/usr/bin/env node
/**
 * Fetch OSC building-block sources we depend on and mirror them under
 * src/bblocks/mirror/ with a manifest showing SHA + fetched-at.
 *
 * Why mirror (per plan `d120-v0.2-scope.md`):
 *  - offline / CI builds don't take GitHub availability as a failure mode
 *  - a bblock schema change reads as an intentional refresh PR, not a
 *    surprise test failure at 3am
 *  - the mirror is the ground truth our contract tests validate against
 *
 * Usage:
 *   npm run bblocks:refresh
 *
 * The tests in tests/bblock-conformance.spec.ts assert that the mirrored
 * shape still matches what our runtime code depends on. Refresh + fix any
 * failing conformance test = intentional uptake of an OSC bblock change.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "ogcincubator/bblocks-openscience";
const REF = "master";
const API_ROOT = `https://api.github.com/repos/${REPO}/contents`;
const RAW_ROOT = `https://raw.githubusercontent.com/${REPO}/${REF}`;

const FILES = [
  {
    src: "_sources/api-profiles/processes/ipt/api/bblock.json",
    dst: "ipt-api.bblock.json",
  },
  {
    src: "_sources/api-profiles/processes/ipt/api/description.md",
    dst: "ipt-api.description.md",
  },
  {
    src: "_sources/api-profiles/processes/ipt/execute/bblock.json",
    dst: "ipt-execute.bblock.json",
  },
  {
    src: "_sources/api-profiles/processes/ipt/execute/schema.yaml",
    dst: "ipt-execute.schema.yaml",
  },
  {
    src: "_sources/api-profiles/processes/ipt/results/bblock.json",
    dst: "ipt-results.bblock.json",
  },
  {
    src: "_sources/api-profiles/processes/ipt/results/schema.yaml",
    dst: "ipt-results.schema.yaml",
  },
  {
    src: "_sources/api-profiles/processes/workflow/bblock.json",
    dst: "workflow.bblock.json",
  },
  {
    src: "_sources/api-profiles/processes/ospd/bblock.json",
    dst: "ospd.bblock.json",
  },
];

async function githubJson(path) {
  const res = await fetch(`${API_ROOT}/${path}?ref=${REF}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "voyager-processes-profiler-refresh",
    },
  });
  if (!res.ok) throw new Error(`GH API ${res.status} for ${path}`);
  return res.json();
}

async function githubRaw(path) {
  const res = await fetch(`${RAW_ROOT}/${path}`, {
    headers: { "User-Agent": "voyager-processes-profiler-refresh" },
  });
  if (!res.ok) throw new Error(`GH raw ${res.status} for ${path}`);
  return res.text();
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const mirrorDir = join(here, "..", "src", "bblocks", "mirror");
  await mkdir(mirrorDir, { recursive: true });

  const manifest = {
    repo: REPO,
    ref: REF,
    fetched_at: new Date().toISOString(),
    files: [],
  };

  for (const f of FILES) {
    const meta = await githubJson(f.src);
    const body = await githubRaw(f.src);
    await writeFile(join(mirrorDir, f.dst), body, "utf8");
    manifest.files.push({
      source_path: f.src,
      mirror_name: f.dst,
      sha: meta.sha,
      size: meta.size,
    });
    console.log(`  ${f.dst} (${body.length} bytes, sha ${meta.sha.slice(0, 12)})`);
  }

  const manifestPath = join(mirrorDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`\nmanifest → ${manifestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
