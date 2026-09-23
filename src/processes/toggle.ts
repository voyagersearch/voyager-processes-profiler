import { readConfig } from "../config.js";
import baseline from "./toggle.json" with { type: "json" };

export type Maturity = "draft" | "beta" | "stable";
export type IptCompliance = "strict" | "permissive";

export interface ProcessToggle {
  maturity: Maturity;
  enabled: boolean;
  iptCompliance: IptCompliance;
}

const DEFAULT: ProcessToggle = {
  maturity: "draft",
  enabled: false,
  iptCompliance: "strict",
};

// Merge order: file baseline → PROCESSES_TOGGLE_OVERRIDE JSON literal.
// The override is deep-merged per activity so ops can flip a single flag
// without restating the whole record.
function loadEffective(): Record<string, ProcessToggle> {
  const effective: Record<string, ProcessToggle> = {};
  for (const [id, t] of Object.entries(baseline as Record<string, ProcessToggle>)) {
    effective[id] = { ...DEFAULT, ...t };
  }
  const raw = readConfig().toggleOverride;
  if (!raw) return effective;
  try {
    const override = JSON.parse(raw) as Record<string, Partial<ProcessToggle>>;
    for (const [id, patch] of Object.entries(override)) {
      effective[id] = { ...(effective[id] ?? DEFAULT), ...patch };
    }
  } catch (err) {
    console.error("[toggle] PROCESSES_TOGGLE_OVERRIDE is not valid JSON:", err);
  }
  return effective;
}

export function getToggle(id: string): ProcessToggle {
  const map = loadEffective();
  return map[id] ?? DEFAULT;
}

export function listEnabledIds(): string[] {
  const map = loadEffective();
  return Object.entries(map)
    .filter(([, t]) => t.enabled)
    .map(([id]) => id);
}
