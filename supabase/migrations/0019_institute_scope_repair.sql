-- KID-149: repair the sibling family backfill where the unscoped version
-- already ran.
--
-- The shipped 0018 stated institute scoping in its header but its statement
-- carried no institute_id predicate, so it linked a parent account to every
-- same-email child at every centre. `account` has no institute column, which
-- means the rows it wrote are cross-tenant by construction: nothing about them
-- is self-evidently wrong to a later query, because the grant they represent
-- is the only evidence that the account belongs to the centre.
--
-- 0018 is corrected in place for every database that has not applied it yet.
-- This file is the other half, for the one that has: a migration is skipped by
-- filename once it is in the ledger, so editing 0018 can never undo what that
-- database already wrote. Both run; neither replaces the other.
--
-- What it does, in order:
--
--   1. Delete the rows the unscoped 0018 wrote that cross an institute
--      boundary. Only rows it could have written are eligible — see the id test
--      below — so this cannot touch a link the application made.
--   2. Re-run the corrected backfill (the body of 0018 as fixed). Links the
--      account legitimately holds are re-asserted, never re-pointed.
--
-- Both halves are idempotent: re-running leaves the same rows.
--
-- ---------------------------------------------------------------------------
-- Identifying a row the unscoped 0018 wrote
--
-- 0018 is the only migration that inserts into family_member, and it is the
-- only place in the codebase that mints a family_member id with md5(...) — a
-- 32-character lowercase hex string. Every application write goes through
-- lib/db.ts uid(), which is Date.now().toString(36) + "-" + random and always
-- contains a hyphen. So a family_member id matching ^[0-9a-f]{32}$ identifies a
-- migration-created row exactly, with no heuristic and no timestamp column to
-- trust. That is the eligibility test below, and it is why the whole repair can
-- be precise: a hyphenated row is never a candidate, however it looks.
-- ---------------------------------------------------------------------------
--
-- A candidate is deleted only when the account is not on file at that child's
-- centre by either first-class source: no invite addressed to it there, and no
-- link it holds there that this repair did not itself create. Requiring a
-- *non-migration* link is what keeps a pair of bad rows at the same centre from
-- vindicating each other — they are both migration-created, so neither counts,
-- and both go.
--
-- Not-found is a correct outcome for this statement. On a database where 0018
-- never applied there is nothing to delete and the delete is a no-op, which is
-- what lets both halves ship together.

DO $$
BEGIN
  IF to_regclass('uq_family_member_account_child') IS NULL THEN
    RAISE EXCEPTION 'KID-149: uq_family_member_account_child is missing. Apply 0017_family_member_unique.sql before 0019_institute_scope_repair.sql.';
  END IF;
END $$;

-- 1. Remove the cross-institute links the unscoped 0018 created.
DELETE FROM family_member fm
USING child c
WHERE fm.child_id = c.id
  -- Migration-created: never a link the application made. See the header.
  AND fm.id ~ '^[0-9a-f]{32}$'
  -- The unscoped 0018 only wrote rows for a matching, non-blank contact.
  AND EXISTS (
    SELECT 1
    FROM contact co
    JOIN account a ON a.id = fm.account_id
    WHERE co.child_id = c.id
      AND co.email IS NOT NULL AND trim(co.email) <> ''
      AND lower(trim(co.email)) = lower(trim(a.email))
  )
  -- No invite puts this account at this centre.
  AND NOT EXISTS (
    SELECT 1
    FROM invite i
    JOIN account a ON a.id = fm.account_id
    WHERE lower(trim(i.email)) = lower(trim(a.email))
      AND i.institute_id = c.institute_id
  )
  -- And no link of its own here that this repair did not create, so two bad
  -- rows at the same centre cannot justify one another.
  AND NOT EXISTS (
    SELECT 1
    FROM family_member fm2
    JOIN child c2 ON c2.id = fm2.child_id
    WHERE fm2.account_id = fm.account_id
      AND c2.institute_id = c.institute_id
      AND fm2.id !~ '^[0-9a-f]{32}$'
  );

-- 2. Re-assert the corrected backfill: the body of 0018 as fixed. Insert-only,
--    so an in-institute link 0018 legitimately created is left exactly as it
--    was, role and created_at included.
INSERT INTO family_member (id, account_id, child_id, role)
WITH matched AS (
  SELECT
    a.id AS account_id,
    c.id AS child_id,
    CASE
      WHEN lower(trim(co.relationship)) IN ('parent', 'family', 'pickup', 'no_access')
        THEN lower(trim(co.relationship))
      ELSE 'parent'
    END AS role,
    ROW_NUMBER() OVER (
      PARTITION BY a.id, c.id
      ORDER BY
        CASE lower(trim(co.relationship))
          WHEN 'parent' THEN 0
          WHEN 'family' THEN 1
          WHEN 'pickup' THEN 2
          ELSE 3
        END,
        lower(trim(co.relationship))
    ) AS contact_rn
  FROM contact co
  JOIN child c ON c.id = co.child_id
  JOIN account a ON a.role = 'parent'
    AND lower(trim(a.email)) = lower(trim(co.email))
  WHERE co.email IS NOT NULL AND trim(co.email) <> ''
    -- The institute boundary. An account belongs to the centres it was invited
    -- to plus the centres it already holds a link at; a contact row is not
    -- evidence, because a contact can be typed at any centre for any address.
    AND EXISTS (
      SELECT 1 FROM (
        SELECT c2.institute_id
        FROM family_member fm
        JOIN child c2 ON c2.id = fm.child_id
        WHERE fm.account_id = a.id
        UNION
        SELECT i.institute_id
        FROM invite i
        WHERE lower(trim(i.email)) = lower(trim(a.email))
      ) owned
      WHERE owned.institute_id = c.institute_id
    )
),
ranked AS (
  SELECT matched.account_id, matched.child_id, matched.role
  FROM matched
  WHERE matched.contact_rn = 1
)
SELECT
  md5(random()::text || clock_timestamp()::text || ranked.account_id || ranked.child_id),
  ranked.account_id,
  ranked.child_id,
  ranked.role
FROM ranked
ON CONFLICT (account_id, child_id) DO NOTHING;
