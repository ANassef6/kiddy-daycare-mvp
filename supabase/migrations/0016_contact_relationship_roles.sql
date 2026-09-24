-- KID-112: contact relationship is exactly 4 roles (parent / family /
-- pickup / no_access). The admin UI no longer accepts free text. This
-- migration maps every legacy free-text value, adds the invite role column
-- that carries access into registration, and adds missing indexes behind the
-- enforcement queries.

-- 1) Invite carries the relationship so registration links with the right role.
ALTER TABLE invite ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'parent';

-- 2) Map legacy free-text contact relationships to the 4 canonical roles.
-- Mirrors normalizeLegacyRelationship() in lib/contact-relationship.ts.
UPDATE contact SET relationship = CASE
  WHEN lower(relationship) IN ('parent', 'family', 'pickup', 'no_access') THEN lower(relationship)
  WHEN lower(relationship) LIKE '%pick%' OR lower(relationship) LIKE '%driver%' OR lower(relationship) LIKE '%nanny%' THEN 'pickup'
  WHEN lower(relationship) LIKE '%no%access%' OR lower(relationship) LIKE '%block%'
    OR lower(relationship) LIKE '%suspend%' OR lower(relationship) LIKE '%unpaid%'
    OR lower(relationship) LIKE '%inactive%' OR lower(relationship) LIKE '%disable%' THEN 'no_access'
  WHEN lower(relationship) LIKE '%grand%' OR lower(relationship) LIKE '%aunt%'
    OR lower(relationship) LIKE '%uncle%' OR lower(relationship) LIKE '%cousin%'
    OR lower(relationship) LIKE '%brother%' OR lower(relationship) LIKE '%sister%'
    OR lower(relationship) LIKE '%sibling%' OR lower(relationship) LIKE '%relative%'
    OR lower(relationship) LIKE '%family%' OR lower(relationship) LIKE '%step%'
    OR lower(relationship) LIKE '%kin%' THEN 'family'
  ELSE 'parent'
END
WHERE lower(relationship) NOT IN ('parent', 'family', 'pickup', 'no_access')
   OR relationship <> lower(relationship);

-- 3) Same mapping for family-link roles (the access-enforcement source).
UPDATE family_member SET role = CASE
  WHEN lower(role) IN ('parent', 'family', 'pickup', 'no_access') THEN lower(role)
  WHEN lower(role) LIKE '%pick%' OR lower(role) LIKE '%driver%' OR lower(role) LIKE '%nanny%' THEN 'pickup'
  WHEN lower(role) LIKE '%no%access%' OR lower(role) LIKE '%block%'
    OR lower(role) LIKE '%suspend%' OR lower(role) LIKE '%unpaid%'
    OR lower(role) LIKE '%inactive%' OR lower(role) LIKE '%disable%' THEN 'no_access'
  WHEN lower(role) LIKE '%grand%' OR lower(role) LIKE '%aunt%'
    OR lower(role) LIKE '%uncle%' OR lower(role) LIKE '%cousin%'
    OR lower(role) LIKE '%brother%' OR lower(role) LIKE '%sister%'
    OR lower(role) LIKE '%sibling%' OR lower(role) LIKE '%relative%'
    OR lower(role) LIKE '%family%' OR lower(role) LIKE '%step%'
    OR lower(role) LIKE '%kin%' THEN 'family'
  ELSE 'parent'
END
WHERE lower(role) NOT IN ('parent', 'family', 'pickup', 'no_access')
   OR role <> lower(role);

-- 4) Backfill invite roles that predate the column (kept in sync by default).
UPDATE invite SET role = 'parent' WHERE role NOT IN ('parent', 'family', 'pickup', 'no_access');

-- 5) Enforce the enum at the database boundary from here on.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contact_relationship') THEN
    ALTER TABLE contact ADD CONSTRAINT chk_contact_relationship
      CHECK (relationship IN ('parent', 'family', 'pickup', 'no_access'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_family_member_role') THEN
    ALTER TABLE family_member ADD CONSTRAINT chk_family_member_role
      CHECK (role IN ('parent', 'family', 'pickup', 'no_access'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invite_role') THEN
    ALTER TABLE invite ADD CONSTRAINT chk_invite_role
      CHECK (role IN ('parent', 'family', 'pickup', 'no_access'));
  END IF;
END
$$;

-- 6) Indexes behind the enforcement lookups (were missing).
CREATE INDEX IF NOT EXISTS idx_contact_child ON contact (child_id);
CREATE INDEX IF NOT EXISTS idx_family_member_account ON family_member (account_id, child_id);
CREATE INDEX IF NOT EXISTS idx_invite_code ON invite (code);
