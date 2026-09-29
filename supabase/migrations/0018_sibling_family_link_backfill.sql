-- KID-146: link children that already existed to the parent account that
-- already owns their email address.
--
-- KID-142 wired the sibling auto-link into addContact(), updateContact() and
-- the register path only. `familiesForAccount()` — the single read path behind
-- every /child/* page — renders from `family_member` alone, so a child whose
-- contact was added *before* 05be841 has no family_member row and never appears
-- in that parent's children list. Re-typing the data was the only fix, which is
-- the exact symptom reported on KID-145.
--
-- Migration 0017 only deduped existing rows and added the unique index; it did
-- not create the missing links. This migration reconciles the existing data:
-- for every (parent account, child) pair where a contact on that child carries
-- the account's email **and the child sits at an institute the account already
-- belongs to**, the missing family_member row is created. No staff re-entry
-- required.
--
-- Deliberate properties:
--  - INSERT-only. An existing family_member row is never updated, so a role an
--    admin set deliberately (e.g. a downgraded or `no_access` link) survives.
--  - Idempotent. `ON CONFLICT (account_id, child_id)` needs the unique index
--    from 0017, which the numeric filename ordering guarantees ran first; the
--    guard below turns a missing index into a legible error instead of 42P10.
--  - One statement, so re-running it is safe at any point.
--
-- Matching rules mirror `linkSiblingsByParentEmail` (lib/store.ts):
--  - Case-insensitive, whitespace-trimmed on both sides (normalizeParentEmail).
--  - Only `role = 'parent'` accounts are linked; staff/admin accounts must
--    never gain family access as a side effect.
--  - Inactive/withdrawn children are linked too. `familiesForAccount` already
--    filters `c.active = 1`, so the link is invisible while withdrawn and
--    access returns without a gap if the child is reactivated.
--  - The contact's `relationship` becomes the link role, falling back to
--    'parent' for anything outside the KID-112 enum (same default as
--    normalizeLegacyRelationship: never lock a real parent out on bad data).
--  - When several same-email contacts on one child disagree about the role,
--    the most permissive wins — the same rule `familyAccessForAccount` already
--    applies across an account's links, so the stored role never contradicts
--    the access the app actually grants.
--
-- ---------------------------------------------------------------------------
-- KID-149: institute scoping. This block is the contract the SQL below
-- implements; the statement and this text must change together.
-- ---------------------------------------------------------------------------
--
-- `account` carries no institute column, so "the institute this account belongs
-- to" is not a column — it has to be derived. The first version of this file
-- *claimed* scoping here but had no `institute_id` predicate anywhere in its
-- statement: it joined a parent account to every child at every centre carrying
-- that address, granting `family_member` across tenant boundaries the
-- application refuses to grant. That is a data-isolation break in a multi-tenant
-- product, and it contradicted the runtime path this migration mirrors —
-- `linkSiblingsByParentEmail` filters `WHERE c.institute_id = ?` (lib/store.ts),
-- and KID-142's acceptance criterion "cross-institute contacts excluded" was
-- signed off as met on that basis.
--
-- The rule the statement below implements:
--
--   A link is created only when the child sits at an institute the account
--   already belongs to, where "belongs to" is the union of two first-class
--   sources — never a value hardcoded here:
--
--     1. Invite rows addressed to the account's email. `registerAction` refuses
--        to create a parent account without a valid invite code, and that invite
--        row survives registration with `institute_id` intact (registering only
--        flips `status` to 'accepted'). So for every parent the daycare itself
--        onboarded, the invite is that centre's own record of "this address is a
--        parent here". Invite status is deliberately not filtered: the consumed
--        invite is precisely the one that matters, and a pending invite is the
--        daycare saying the same thing before the parent has accepted.
--     2. `family_member` links the account already holds. Access that has
--        already been granted is by definition legitimate, and it is what
--        anchors a parent whose children were enrolled before the invite flow
--        existed.
--
-- Determinism for the multi-institute case — a parent address that appears as a
-- contact at more than one centre: each candidate child is evaluated on its own
-- `institute_id` against that account's derived set. A child is linked only if
-- its centre is in the set, so the result never depends on which centre is seen
-- first, and the backfill never quietly bridges two centres. The set is a union,
-- not a single "home centre", so a parent genuinely enrolled at two centres is
-- still linked at both — that is the one-profile-across-centres behaviour the
-- product intends, and it is now opt-in by evidence instead of by coincidence.
--
-- Zero-link edge case, stated rather than left undefined: an account with
-- **neither** an invite nor an existing link — a shared, generic or mistyped
-- address with no tenancy evidence — belongs to no centre, so this migration
-- creates nothing for it. That is deliberate. Inferring an institute from a
-- matching address is precisely the defect this revision removes. Such an
-- account is linked the moment a staff member touches a contact or issues an
-- invite at the real centre, which is the application's own path
-- (`autoLinkSiblingsForContact` / the register flow), so the outcome is a
-- conservative miss rather than a cross-tenant grant.
--
-- Repair path: this revision edits the first version of this file in place
-- because that version was never applied to any environment — the ledger check
-- for it is owned by the deploy gate (KID-147), which is blocked on KID-149 and
-- whose acceptance criteria require querying `schema_migrations` on live Postgres
-- before anything is applied. `0018_sibling_family_link_backfill.sql` was
-- therefore never recorded in any `schema_migrations` table, so the corrected
-- statement below is the one that runs. Its own statement is insert-only by
-- design, so it cannot remove a row an earlier revision created; if a ledger
-- ever shows this file applied while carrying the old cross-institute body, the
-- correction must ship as a *new* migration that deletes those rows, because this
-- filename is already recorded and would be skipped.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_family_member_account_child') THEN
    RAISE EXCEPTION
      'KID-146: uq_family_member_account_child is missing. Apply 0017_family_member_unique.sql before 0018_sibling_family_link_backfill.sql.';
  END IF;
END
$$;

INSERT INTO family_member (id, account_id, child_id, role)
SELECT
  md5(random()::text || clock_timestamp()::text || ranked.account_id || ranked.child_id),
  ranked.account_id,
  ranked.child_id,
  ranked.role
FROM (
  SELECT
    matched.account_id,
    matched.child_id,
    matched.role,
    ROW_NUMBER() OVER (
      PARTITION BY matched.account_id, matched.child_id
      ORDER BY
        CASE matched.role
          WHEN 'parent'    THEN 0
          WHEN 'family'    THEN 1
          WHEN 'pickup'    THEN 2
          ELSE 3
        END,
        matched.role
    ) AS rn
  FROM (
    SELECT
      a.id  AS account_id,
      c.id  AS child_id,
      CASE
        WHEN lower(trim(co.relationship)) IN ('parent', 'family', 'pickup', 'no_access')
          THEN lower(trim(co.relationship))
        ELSE 'parent'
      END AS role
    FROM contact co
    JOIN child c ON c.id = co.child_id
    JOIN account a
      ON a.role = 'parent'
     AND lower(trim(a.email)) = lower(trim(co.email))
    WHERE co.email IS NOT NULL
      AND trim(co.email) <> ''
      -- KID-149: the institute boundary. The child is linked only when its own
      -- centre is one the account already belongs to, per the derivation in the
      -- header. `account` has no institute column, so the two sources are the
      -- invite addressed to that address and the links it already holds.
      AND EXISTS (
        SELECT 1
        FROM (
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
  ) matched
) ranked
WHERE ranked.rn = 1
ON CONFLICT (account_id, child_id) DO NOTHING;
