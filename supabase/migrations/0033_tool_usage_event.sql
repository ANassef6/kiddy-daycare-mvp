-- KID-481: cross-tenant tool usage analytics for the super-admin Billing +
-- Insights page.
--
-- One row per recorded tool usage (a page view of a tool's surface, or a
-- significant in-tool action). Reuses the same event-foundation style as
-- 0030_audit_event (KID-477): add-only writes, tenant-scoped, database-side
-- timestamps, bounded non-sensitive JSON metadata. It is a separate table —
-- audit_event is a legal "who changed what" record, this one is an analytics
-- cursor, and their lifecycles (retention, cardinality, reads) differ.
--
-- Storage rules mirror 0030:
--   institute_id       tenant scope (NULL for platform-surface-only events,
--                      e.g. the operator visiting the billing module itself
--                      without per-daycare context).
--   account_id         the using account (SET NULL so deleting an account
--                      never breaks history — same style as 0015/0026/0030).
--   tool_key           stable key from lib/tool-usage.ts TOOLS (never a route
--                      path, so routes can move without breaking history).
--   source             'portal' | 'child' | 'platform' | 'backfill'
--                      backfill rows are historical usage ESTIMATES derived
--                      from existing domain tables (lib/tool-usage.ts), always
--                      labeled estimate in metadata — never presented as
--                      literal recorded visits.
--   metadata           bounded JSON (ids, counts, estimate flags) — never
--                      secrets or message/body text.
--   occurred_at        database timestamp (pg now() / SQLite datetime('now')).

CREATE TABLE IF NOT EXISTS tool_usage_event (
  id TEXT PRIMARY KEY,
  institute_id TEXT REFERENCES institute(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES account(id) ON DELETE SET NULL,
  tool_key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'portal',
  metadata TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_usage_institute_when
  ON tool_usage_event (institute_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_usage_tool_when
  ON tool_usage_event (tool_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_usage_account_when
  ON tool_usage_event (account_id, occurred_at DESC);
