-- KID-173: link the existing centre owner login to its existing unlinked staff record
--
-- Production was seeded before commit 2fd0129 added the UPDATE that joins
-- staff(admin Maria Lopez) to account(admin@sunshinedaycare.test, owner). Both
-- rows exist but are not joined. This is a pure UPDATE (no INSERT/DELETE of
-- accounts, no credential creation).

UPDATE account a
SET staff_id = s.id
FROM staff s
WHERE a.staff_id IS NULL
  AND s.institute_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM account a2 WHERE a2.staff_id = s.id)
  AND a.role <> 'parent'
  AND lower(trim(a.full_name)) = lower(trim(s.full_name))
  AND (
    EXISTS (
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
      WHERE owned.institute_id = s.institute_id
    )
    OR (
      (SELECT COUNT(*) FROM institute) = 1
      AND s.institute_id = (SELECT id FROM institute LIMIT 1)
    )
  )
  AND s.id = (
    SELECT s2.id
    FROM staff s2
    WHERE s2.institute_id = s.institute_id
      AND lower(trim(s2.full_name)) = lower(trim(a.full_name))
      AND NOT EXISTS (SELECT 1 FROM account a3 WHERE a3.staff_id = s2.id)
    ORDER BY s2.created_at ASC, s2.id ASC
    LIMIT 1
  );
