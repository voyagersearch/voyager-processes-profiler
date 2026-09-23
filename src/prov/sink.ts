/**
 * Voyager HQ helpers used by process handlers:
 *   hqSearch(cfg, req)  — POST /api/search/{collection}, returns doc list
 *   putSidecar(cfg, doc) — POST /api/files/edit/{root} multipart, writes one
 *                          PROV sidecar into the folder repo the register
 *                          consumer reads from (matches voyager-mastra-full-rag
 *                          pattern; see that repo's src/prov/sink.ts).
 *
 * Cookie session auth with HQ 3.x — same handshake voyager-hq-3.x-mcp uses.
 * The handshake is kept local to this file so the standalone repo has no
 * hard dep on the MCP package, only on `voyager-prov-ts` (for the sidecar
 * type shape).
 */

import type { Config } from "../config.js";

let hqCookie: string | null = null;
let hqCookieExpiry = 0;
let loginInFlight: Promise<void> | null = null;

async function ensureLogin(cfg: Config): Promise<void> {
  if (hqCookie && Date.now() < hqCookieExpiry) return;
  if (loginInFlight) return loginInFlight;
  if (!cfg.hq.baseUrl) throw new Error("HQ_BASE_URL is required");

  loginInFlight = (async () => {
    try {
      const url = `${cfg.hq.baseUrl}/api/auth/realms/internal/login?user=${encodeURIComponent(
        cfg.hq.username
      )}&pass=${encodeURIComponent(cfg.hq.password)}&remember=false`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error(`HQ login HTTP ${res.status}`);
      const anyHdrs = res.headers as unknown as { getSetCookie?: () => string[] };
      const cookies: string[] =
        typeof anyHdrs.getSetCookie === "function"
          ? anyHdrs.getSetCookie()
          : (res.headers.get("set-cookie") ?? "").split(/,\s*(?=[a-zA-Z0-9_-]+=)/);
      let token: string | null = null;
      for (const c of cookies) {
        const m = /^\s*vg-token=([^;]+)/.exec(c);
        if (m) token = m[1];
      }
      if (!token) throw new Error("HQ login did not return vg-token cookie");
      hqCookie = `vg-token=${token}`;
      hqCookieExpiry = Date.now() + 30 * 60 * 1000;
    } finally {
      loginInFlight = null;
    }
  })();
  return loginInFlight;
}

export interface HqSearchRequest {
  collection: string;
  query: string;
  limit: number;
  filter?: string;
  fields?: string[];
}

export interface HqDoc extends Record<string, unknown> {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  score?: unknown;
}

export async function hqSearch(cfg: Config, req: HqSearchRequest): Promise<HqDoc[]> {
  await ensureLogin(cfg);
  const url = `${cfg.hq.baseUrl}/api/search/${encodeURIComponent(req.collection)}`;
  const body = JSON.stringify({
    query: req.query,
    filter: req.filter,
    limit: req.limit,
    fields: req.fields,
  });
  let res = await fetch(url, {
    method: "POST",
    headers: { Cookie: hqCookie!, "Content-Type": "application/json" },
    body,
  });
  if (res.status === 401) {
    hqCookie = null;
    hqCookieExpiry = 0;
    await ensureLogin(cfg);
    res = await fetch(url, {
      method: "POST",
      headers: { Cookie: hqCookie!, "Content-Type": "application/json" },
      body,
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HQ /api/search HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const payload = (await res.json()) as { response?: { docs?: HqDoc[] } };
  return payload.response?.docs ?? [];
}

/**
 * Write one PROV sidecar as JSON at {root}/{subpath}/{shard}/{slug}.json —
 * shard = first hex char of slug, matching voyager-mastra-full-rag's pattern
 * so the same folder-repo consumer picks up records from both services.
 */
export async function putSidecar(
  cfg: Config,
  slug: string,
  doc: Record<string, unknown>
): Promise<void> {
  await ensureLogin(cfg);
  const shard = /^[0-9a-f]/.test(slug) ? slug[0]! : "z";
  const filePath = `${cfg.hq.provSubpath}/${shard}/${slug}.json`;
  const url = `${cfg.hq.baseUrl}/api/files/edit/${encodeURIComponent(
    cfg.hq.provRoot
  )}?path=${encodeURIComponent(filePath)}`;
  const body = JSON.stringify(doc);
  const buildForm = (): FormData => {
    const f = new FormData();
    f.append("file", new Blob([body], { type: "application/json" }), `${slug}.json`);
    return f;
  };
  let res = await fetch(url, {
    method: "POST",
    headers: { Cookie: hqCookie! },
    body: buildForm(),
  });
  if (res.status === 401) {
    hqCookie = null;
    hqCookieExpiry = 0;
    await ensureLogin(cfg);
    res = await fetch(url, {
      method: "POST",
      headers: { Cookie: hqCookie! },
      body: buildForm(),
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HQ /api/files POST HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}
