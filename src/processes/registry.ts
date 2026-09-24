import type { Config } from "../config.js";
import type { NormalisedIptRequest } from "../prov/emit.js";
import { generateHandler, generateProcessMeta } from "./generate.js";
import {
  buildPlaybackHandler,
  buildPlaybackMeta,
  PLAYBACK_PROCESSES,
} from "./playback-factory.js";
import { rankHandler, rankProcessMeta } from "./rank.js";
import { retrieveHandler, retrieveProcessMeta } from "./retrieve.js";
import { listEnabledIds } from "./toggle.js";
import { workflowHandler, workflowProcessMeta } from "./workflow.js";

export interface ProcessMeta {
  id: string;
  title: string;
  description: string;
  version: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

export type ProcessHandler = (
  req: NormalisedIptRequest,
  cfg: Config
) => Promise<Record<string, unknown>>;

// v0.1 processes (real execute strategy) + v0.2 Phase 4 workflow composite
const REAL_META: Record<string, ProcessMeta> = {
  retrieve: retrieveProcessMeta,
  rank: rankProcessMeta,
  generate: generateProcessMeta,
  "rag-workflow": workflowProcessMeta,
};

const REAL_HANDLERS: Record<string, ProcessHandler> = {
  retrieve: retrieveHandler,
  rank: rankHandler,
  generate: generateHandler,
  "rag-workflow": workflowHandler,
};

// v0.2 Phase 3 · playback-strategy processes covering the rest of the D100
// 12-type activity enum. Built from PLAYBACK_PROCESSES.
const PLAYBACK_META: Record<string, ProcessMeta> = Object.fromEntries(
  PLAYBACK_PROCESSES.map((d) => [d.activityType, buildPlaybackMeta(d)])
);

const PLAYBACK_HANDLERS: Record<string, ProcessHandler> = Object.fromEntries(
  PLAYBACK_PROCESSES.map((d) => [d.activityType, buildPlaybackHandler(d)])
);

const META: Record<string, ProcessMeta> = { ...REAL_META, ...PLAYBACK_META };
const HANDLERS: Record<string, ProcessHandler> = { ...REAL_HANDLERS, ...PLAYBACK_HANDLERS };

export function getEnabledProcesses(): ProcessMeta[] {
  return listEnabledIds()
    .map((id) => META[id])
    .filter((m): m is ProcessMeta => Boolean(m));
}

/**
 * Bblock identifiers this D120 conforms to for every process. Advertised in
 * each process description so an LLM caller or a validating client can pull
 * the actual schema shapes from OSC without us having to inline them here.
 * See docs/D110-INTEGRATION.md for the full profile chain.
 */
const COMMON_CONFORMS_TO = [
  "ogc.api.processes.v1",
  "ogc.osc.api-profiles.processes.ipt.api",
  "ogc.osc.api-profiles.processes.ipt.execute",
  "ogc.osc.api-profiles.processes.ipt.results",
];
// Additional bblocks that the composite workflow process conforms to on top.
const WORKFLOW_CONFORMS_TO = ["ogc.osc.api-profiles.processes.workflow"];

function conformsToFor(id: string): string[] {
  if (id === "rag-workflow") return [...COMMON_CONFORMS_TO, ...WORKFLOW_CONFORMS_TO];
  return COMMON_CONFORMS_TO;
}

export interface ProcessDescription extends ProcessMeta {
  links: unknown[];
  "voy:conformsTo": Array<{ "@id": string; "voy:bblockId": string }>;
}

export function getProcessDescription(id: string, cfg: Config): ProcessDescription | null {
  const meta = META[id];
  if (!meta) return null;
  return {
    ...meta,
    // Discoverability: each conformsTo id is resolvable at
    // https://ogcincubator.github.io/bblocks-openscience/bblock/<id>
    // — clients that speak bblocks can validate our responses against these
    // without pulling the schemas from us.
    "voy:conformsTo": conformsToFor(id).map((bblockId) => ({
      "@id": `https://ogcincubator.github.io/bblocks-openscience/bblock/${bblockId}`,
      "voy:bblockId": bblockId,
    })),
    links: [
      { href: `${cfg.publicBaseUrl}/processes/${id}`, rel: "self", type: "application/json" },
      { href: `${cfg.publicBaseUrl}/processes/${id}/execution`, rel: "http://www.opengis.net/def/rel/ogc/1.0/execute", type: "application/json" },
      ...conformsToFor(id).map((bblockId) => ({
        href: `https://ogcincubator.github.io/bblocks-openscience/bblock/${bblockId}`,
        rel: "http://www.opengis.net/def/rel/ogc/1.0/conformance",
        type: "text/html",
        title: `Bblock: ${bblockId}`,
      })),
      ...(cfg.registerBaseUrl
        ? [{ href: `${cfg.registerBaseUrl}/activities/${id}`, rel: "http://www.opengis.net/def/rel/ogc/1.0/definition", type: "application/json" }]
        : []),
    ],
  };
}

export function getHandler(id: string): ProcessHandler | null {
  return HANDLERS[id] ?? null;
}
