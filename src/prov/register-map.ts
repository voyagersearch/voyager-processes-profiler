/**
 * PROV_REGISTER_MAP resolver — mirrors voyager-prov-ts's remap.ts behaviour
 * so D120's sidecar-writer honours the same env-driven register mapping the
 * D100 HQ pipeline uses.
 *
 * voyager-prov-ts's `activityTypeURI()` helper does this same thing, but its
 * ActivityType type is strictly the D100 12-enum. D120 emits process ids
 * outside that enum (`rank`, `rag-workflow`) so we can't call it directly —
 * this module accepts any string.
 *
 * Set the env at deploy time to route emissions through the D110 register:
 *
 *   PROV_REGISTER_MAP=/etc/voyager/prov-register.json
 *
 *   # or inline
 *   PROV_REGISTER_MAP='{"geotag":"https://d110.ogc.org/registers/prov-activity/geotag"}'
 *
 * Missing / unreadable / malformed → falls back silently to the Voyager
 * internal namespace, matching voyager-prov-ts's tolerance rule (emission
 * MUST NOT fail because a register can't be loaded).
 *
 * Resolved once at module import — matches voyager-prov-ts's stability
 * contract: within a single process run, one activity type maps to one URI.
 */

import { existsSync, readFileSync } from "node:fs";

import { VOYAGER_ACTIVITY_NS } from "voyager-prov-ts";

export const REGISTER_ENV_VAR = "PROV_REGISTER_MAP";
export type RegisterMap = Record<string, string>;

function safeReadFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function loadRegisterMapFromEnv(): RegisterMap {
  const raw = process.env[REGISTER_ENV_VAR];
  if (!raw || raw.trim() === "") return {};
  const text = raw.trim().startsWith("{") ? raw : safeReadFile(raw);
  if (text == null) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const cleaned: RegisterMap = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") cleaned[k] = v;
      }
      return Object.freeze(cleaned);
    }
  } catch (err) {
    console.error(
      `[voyager-processes-profiler] failed to parse ${REGISTER_ENV_VAR} (${err instanceof Error ? err.message : err}); falling back to internal namespace.`
    );
  }
  return {};
}

// Load once at module import (stability contract).
const DEFAULT_MAP: RegisterMap = loadRegisterMapFromEnv();

/**
 * Resolve a process id to its prov_activityType URI, applying the loaded
 * register map first and falling back to VOYAGER_ACTIVITY_NS.
 *
 * `mapOverride` lets tests inject a map without touching env.
 */
export function activityTypeUri(processId: string, mapOverride?: RegisterMap): string {
  const map = mapOverride ?? DEFAULT_MAP;
  return map[processId] ?? `${VOYAGER_ACTIVITY_NS}${processId}`;
}
