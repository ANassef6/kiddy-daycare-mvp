-- KID-1177 (F-02): database RLS hardening — deny by default, allow by decision.
--
-- The recorded model (decided here, in the migration, so the ledger carries
-- the decision with the schema):
--
--   The application talks to Postgres exclusively through a direct `pg`
--   connection (KIDDY_DATABASE_URL) whose role owns the app tables and wrote
--   every migration in this ledger (lib/db.ts ensurePgSchema). Table owners
--   are exempt from RLS, so the app keeps working unchanged. Every OTHER role
--   — anon, authenticated, any future client role or an exposed PostgREST —
--   is DENIED: no permissive policy exists on any app table except the single
--   intended one below. This is the "enable RLS with deny-by-default
--   least-privilege" option of the F-02 remediation: the cheapest safe shape
--   for a server-only data layer, and it is forward-safe — a future query
--   path that reaches these tables without the owner role stops at RLS.
--
--   Deliberately NOT the alternative (row policies keyed on institute_id /
--   app.current_institute session context): the app never connects as a
--   non-owner role, so those policies would be untestable dead behaviour
--   today, and plumbing per-session tenancy through shared-pool requests is
--   a rework, not a hardening. When a real client query path is added, its
--   policies must be written for it — tenancy stays a server-side contract
--   (KID-149/152 + every action's scope checks).
--
--   FORCE ROW LEVEL SECURITY is also deliberately NOT enabled: the owning
--   role is the app itself, and forcing would deny the app. The defence here
--   is against other roles, and revokes below make that belt-and-braces.
--
--   service_role keeps Supabase's BYPASSRLS and its default grants — it
--   CANNOT be meaningfully denied at the policy layer. Its compensating
--   control is that the key is server-only: lib/storage.ts and the GoTrue
--   admin helpers (lib/invite-email.ts, lib/contact-notify.ts,
--   lib/invoice-notify.ts) are the only readers, never a client bundle, a
--   log or an error response (pinned by tests/unit/kid1177-rls-storage.test.ts).
--
-- Everything in this file is idempotent: safe to re-run on a partially
-- applied chain, safe under the verify-migrations harness, and safe to run
-- again after a future migration adds tables (the DO loops enumerate live
-- tables rather than hardcode a list).

DO $$
DECLARE
  r RECORD;
BEGIN
  -- 1. Enable RLS on every user table reachable through the connection's
  --    search path (the app schema, or the verify harness's scratch schema).
  --    No CREATE POLICY here: a table with RLS ENABLED and no permissive
  --    policy denies every non-owner role by definition.
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname = ANY (current_schemas(false))
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
  END LOOP;

  -- 2. Knit the grants shut. Supabase-style default privileges auto-grant
  --    ALL on new tables to anon/authenticated; RLS blocks SELECT/INSERT/
  --    UPDATE/DELETE but not TRUNCATE/REFERENCES/TRIGGER, so the explicit
  --    revokes matter too. Same enumeration as above so the harness keeps
  --    moving under its scratch schema.
  FOR r IN
    SELECT unnest(current_schemas(false)) AS schema_name
  LOOP
    IF r.schema_name IS NULL OR r.schema_name = 'pg_catalog'
       OR r.schema_name = 'information_schema' THEN CONTINUE; END IF;
    EXECUTE format(
      'REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM anon, authenticated',
      r.schema_name);
    EXECUTE format(
      'REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM anon, authenticated',
      r.schema_name);
    -- Keep schema USAGE: on Supabase public already carries it, but a fresh
    -- created schema (as the verify harness has) resolves nothing for the
    -- role without it, which makes every probe read as "does not exist"
    -- exactly when it is a grant to make.
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated', r.schema_name);
    -- Stop future auto-grants for tables this connection creates. Objects
    -- created by other roles (e.g. a dashboard SQL editor session) still
    -- need their own review — noted in the header.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM anon, authenticated',
      r.schema_name);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM anon, authenticated',
      r.schema_name);
  END LOOP;
END $$;

-- 3. The intended path: the marketing-site lead capture (0003) stays open
--    for anonymous INSERT — one column-safe lead in, no reading, no listing.
GRANT INSERT ON contact_request TO anon, authenticated;
