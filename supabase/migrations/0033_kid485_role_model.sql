-- KID-485: role model change — `owner | admin | staff | carer | parent`
-- becomes `owner | admin | teacher | caregiver | parent`.
--
--   staff.role   'carer' | 'staff'  ->  'teacher'  (the classroom-scoped floor)
--   account.role 'carer' | 'staff'  ->  'teacher'  (linked login accounts)
--   staff.role   'admin'            ->  promotes the LINKED account to 'admin',
--                                      so an admin-labeled staff member's login
--                                      keeps the real portal-admin surface.
--   staff.role   DEFAULT            ->  'teacher' (also for SQLite mirrors:
--                                      lib/sqlite-schema.ts carries the same
--                                      backfill idempotently).
--
-- Owner rows and owner accounts are untouched. Every statement is idempotent:
-- on an already-migrated database the UPDATEs match nothing and the ALTER
-- re-asserts the same default, so a replay is a no-op.
ALTER TABLE staff ALTER COLUMN role SET DEFAULT 'teacher';

UPDATE staff SET role = 'teacher' WHERE role IN ('carer', 'staff');
UPDATE account SET role = 'teacher' WHERE role IN ('carer', 'staff');

-- An admin-labeled staff record means its linked login must be a real portal
-- admin. Only accounts that are NOT already admin/owner are promoted, so a
-- replay can never downgrade anyone.
UPDATE account a
SET role = 'admin'
FROM staff s
WHERE a.staff_id = s.id
  AND s.role = 'admin'
  AND a.role NOT IN ('admin', 'owner');
