-- KID-199.4r: the platform operator is not a daycare role.
--
-- The board decision (KID-210) makes /platform access an env-based operator
-- allowlist (lib/platform.ts, PLATFORM_ADMIN_EMAIL) checked in the page guard
-- and re-checked inside every server action. The KID-199.3 stopgap stored the
-- operator as a `superadmin` role row; that value no longer exists in the
-- role code (`lib/role.ts` stops at owner|admin|staff|carer|parent), so the
-- data must move onto the internal sentinel role (`platform`) instead:
--
--   - Not offered as a selectable role by any UI or account-creation path
--     (lib/auth.ts createAccount validates against the role union).
--   - Tenant scoping keeps treating the sentinel as "no tenant"
--     (lib/tenant.ts), same as KID-199.3 did for the stopgap value.
--   - Idempotent: no rows match after the first run.

UPDATE account SET role = 'platform' WHERE role = 'superadmin';
