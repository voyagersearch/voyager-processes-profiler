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

// v0.1 processes (real execute strategy)
const REAL_META: Record<string, ProcessMeta> = {
  retrieve: retrieveProcessMeta,
  rank: rankProcessMeta,
  generate: generateProcessMeta,
};

const REAL_HANDLERS: Record<string, ProcessHandler> = {
  retrieve: retrieveHandler,
  rank: rankHandler,
  generate: generateHandler,
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

export function getProcessDescription(id: string, cfg: Config): (ProcessMeta & { links: unknown[] }) | null {
  const meta = META[id];
  if (!meta) return null;
  return {
    ...meta,
    links: [
      { href: `${cfg.publicBaseUrl}/processes/${id}`, rel: "self", type: "application/json" },
      { href: `${cfg.publicBaseUrl}/processes/${id}/execution`, rel: "http://www.opengis.net/def/rel/ogc/1.0/execute", type: "application/json" },
      ...(cfg.registerBaseUrl
        ? [{ href: `${cfg.registerBaseUrl}/activities/${id}`, rel: "http://www.opengis.net/def/rel/ogc/1.0/definition", type: "application/json" }]
        : []),
    ],
  };
}

export function getHandler(id: string): ProcessHandler | null {
  return HANDLERS[id] ?? null;
}
