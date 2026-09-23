import type { Config } from "../config.js";
import type { NormalisedIptRequest } from "../prov/emit.js";
import { generateHandler, generateProcessMeta } from "./generate.js";
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

const META: Record<string, ProcessMeta> = {
  retrieve: retrieveProcessMeta,
  rank: rankProcessMeta,
  generate: generateProcessMeta,
};

const HANDLERS: Record<string, ProcessHandler> = {
  retrieve: retrieveHandler,
  rank: rankHandler,
  generate: generateHandler,
};

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
