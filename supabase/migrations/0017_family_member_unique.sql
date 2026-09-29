-- KID-142: one family link per (account, child) pair.
--
-- linkFamily() relied on `ON CONFLICT DO NOTHING` to stay idempotent, but
-- family_member had no unique constraint on (account_id, child_id) — only a
-- plain index — so the conflict clause never fired and every re-link inserted
-- a duplicate row. Duplicates broke "parent account gains access to all linked
-- children" (children list rendered twice) and made the sibling auto-link
-- non-idempotent on re-run.
--
-- 1) Collapse existing duplicates, keeping the most recently created row per
--    pair so role edits are not silently lost.
-- 2) Add the unique index that makes the upsert in linkFamily() a real upsert.
--    IF NOT EXISTS keeps re-runs (and the warm-request migration ledger) safe.

DELETE FROM family_member
WHERE id NOT IN (
  SELECT keep_id FROM (
    SELECT id AS keep_id,
           ROW_NUMBER() OVER (
             PARTITION BY account_id, child_id
             ORDER BY created_at DESC, id DESC
           ) AS rn
    FROM family_member
  ) ranked
  WHERE ranked.rn = 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_family_member_account_child
  ON family_member (account_id, child_id);
