import type { Row } from "./db";

// KID-2494 follow-up: the portal consent list crashed on staging Postgres with
// `subquery uses ungrouped column "cr.id" from outer query`. The creator
// lookup was a correlated subquery inside a GROUP BY. Keep the aggregate and
// the creator snapshot as two portable statements instead, so SQLite (tests)
// and Postgres (staging/production) run the same semantics.
//
// Both statements take the institute id as their only `?` parameter.
export const CONSENT_BATCHES_SQL = `SELECT COALESCE(cr.batch_id, cr.id) AS batch_id,
       MIN(cr.title) AS title,
       MIN(cr.body) AS body,
       MIN(cr.created_at) AS created_at,
       COUNT(*) AS total,
       SUM(CASE WHEN cr.status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN cr.status = 'approved' THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN cr.status = 'denied' THEN 1 ELSE 0 END) AS denied,
       SUM(CASE WHEN cr.child_id IS NULL THEN 1 ELSE 0 END) AS general_count
     FROM consent_request cr
     WHERE cr.institute_id = ?
     GROUP BY COALESCE(cr.batch_id, cr.id)
     ORDER BY created_at DESC`;

// One send can have several create events (one per per-child row), so the list
// keeps the newest name per batch. Ordering here makes the first row win.
export const CONSENT_BATCH_CREATORS_SQL = `SELECT COALESCE(cr.batch_id, cr.id) AS batch_id,
       ae.actor_name, ae.created_at
     FROM consent_request cr
     JOIN audit_event ae
       ON ae.entity_type = 'consent_request'
      AND ae.entity_id = cr.id
      AND ae.action = 'create'
     WHERE cr.institute_id = ?
     ORDER BY ae.created_at DESC`;

export const CONSENT_BATCH_ROOMS_SQL = `SELECT DISTINCT COALESCE(cr.batch_id, cr.id) AS batch_id, r.name AS room_name
     FROM consent_request cr
     JOIN child c ON c.id = cr.child_id
     JOIN room r ON r.id = c.room_id
     WHERE cr.institute_id = ?
     ORDER BY r.name`;

export function attachConsentBatchCreators(batches: Row[], creators: Row[]): Row[] {
  const byBatch = new Map<string, string>();
  for (const row of creators) {
    const key = String(row.batch_id);
    if (!byBatch.has(key)) byBatch.set(key, String(row.actor_name ?? ""));
  }
  return batches.map((batch) => ({
    ...batch,
    created_by_name: byBatch.get(String(batch.batch_id)) ?? null,
  }));
}
