/**
 * PROV_REGISTER_MAP resolver tests. The env-driven DEFAULT_MAP is loaded at
 * module import (matching voyager-prov-ts's stability contract), so the
 * exported `activityTypeUri` accepts a `mapOverride` argument for tests
 * rather than shipping ESM-import reload gymnastics.
 */

import { describe, it, expect } from "vitest";

import {
  activityTypeUri,
  loadRegisterMapFromEnv,
  REGISTER_ENV_VAR,
  type RegisterMap,
} from "../src/prov/register-map.js";

describe("activityTypeUri fallback", () => {
  it("returns VOYAGER_ACTIVITY_NS + processId when no mapping present", () => {
    const empty: RegisterMap = {};
    expect(activityTypeUri("retrieve", empty)).toBe(
      "https://voyager.ogc/prov/activity/retrieve"
    );
    expect(activityTypeUri("rag-workflow", empty)).toBe(
      "https://voyager.ogc/prov/activity/rag-workflow"
    );
  });
});

describe("activityTypeUri with explicit map override", () => {
  const map: RegisterMap = {
    geotag: "https://d110.ogc.org/registers/prov-activity/geotag",
    "classify-commodity": "https://d110.ogc.org/registers/prov-activity/classify-commodity",
  };

  it("uses register URI when the process id has a mapping", () => {
    expect(activityTypeUri("geotag", map)).toBe(
      "https://d110.ogc.org/registers/prov-activity/geotag"
    );
    expect(activityTypeUri("classify-commodity", map)).toBe(
      "https://d110.ogc.org/registers/prov-activity/classify-commodity"
    );
  });

  it("falls back to internal namespace for process ids not in the map", () => {
    expect(activityTypeUri("retrieve", map)).toBe(
      "https://voyager.ogc/prov/activity/retrieve"
    );
    expect(activityTypeUri("rag-workflow", map)).toBe(
      "https://voyager.ogc/prov/activity/rag-workflow"
    );
  });
});

describe("loadRegisterMapFromEnv", () => {
  const orig = process.env[REGISTER_ENV_VAR];
  const restore = () => {
    if (orig === undefined) delete process.env[REGISTER_ENV_VAR];
    else process.env[REGISTER_ENV_VAR] = orig;
  };

  it("returns empty when env var unset", () => {
    delete process.env[REGISTER_ENV_VAR];
    try {
      expect(loadRegisterMapFromEnv()).toEqual({});
    } finally {
      restore();
    }
  });

  it("parses an inline JSON literal", () => {
    process.env[REGISTER_ENV_VAR] = '{"geotag":"https://d110.ogc.org/registers/prov-activity/geotag"}';
    try {
      const m = loadRegisterMapFromEnv();
      expect(m.geotag).toBe("https://d110.ogc.org/registers/prov-activity/geotag");
    } finally {
      restore();
    }
  });

  it("swallows malformed JSON and returns empty (never throws)", () => {
    process.env[REGISTER_ENV_VAR] = "{not-json";
    try {
      expect(loadRegisterMapFromEnv()).toEqual({});
    } finally {
      restore();
    }
  });

  it("ignores non-string values in the map", () => {
    process.env[REGISTER_ENV_VAR] = '{"geotag":"https://x/geotag","bad":42,"also":null}';
    try {
      const m = loadRegisterMapFromEnv();
      expect(m.geotag).toBe("https://x/geotag");
      expect(m.bad).toBeUndefined();
      expect(m.also).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("silently returns empty when the value points at a missing file path", () => {
    process.env[REGISTER_ENV_VAR] = "/tmp/definitely-not-a-real-file-" + Date.now() + ".json";
    try {
      expect(loadRegisterMapFromEnv()).toEqual({});
    } finally {
      restore();
    }
  });
});
