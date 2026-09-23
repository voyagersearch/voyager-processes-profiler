/**
 * In-memory store of the prov:Activity records D120 has generated this
 * process lifetime. Keyed by activity UUID (the stable server-side handle
 * — client-nominated activity_id IRIs are echoed inside each record but
 * not used as store keys since they may not be URL-safe or unique).
 *
 * Two callers today:
 *   - src/prov/emit.ts writes on every execute
 *   - src/routes/prov.ts reads for /prov/activity/:id (the target of
 *     ?provenance=reference responses)
 *
 * A persistent store (LibSQL / Redis) is a v0.3 concern per
 * d120-v0.2-scope.md. Runtime is ephemeral; the sidecar copy in HQ Solr
 * (wired in Phase 2 · B2) is the durable record.
 */

export interface StoredProvActivity {
  uuid: string;
  activity_id: string;
  agent_id: string;
  result_id: string;
  process_id: string;
  block: Record<string, unknown>;
  created_at: string;
}

const store = new Map<string, StoredProvActivity>();

export function saveProvActivity(rec: StoredProvActivity): void {
  store.set(rec.uuid, rec);
}

export function getProvActivity(uuid: string): StoredProvActivity | null {
  return store.get(uuid) ?? null;
}

export function _resetProvStoreForTests(): void {
  store.clear();
}
