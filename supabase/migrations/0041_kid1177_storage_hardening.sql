-- KID-1177 (F-02): storage hardening — kiddy-public stops being writable by
-- anonymous credentials, and every sensitive object class moves to a PRIVATE
-- bucket read only through service-key signed URLs.
--
-- What the review found (recorded so the ledger carries the decision):
--   * The app's own storage writes (payment proofs, contract drafts, the
--     signed contract snapshots, child/staff photos, branding) ran over the
--     anon key (NEXT_PUBLIC_...), so the kiddy-public bucket carried a custom
--     anonymous WRITE policy. Anyone who could read the browser bundle — i.e.
--     anyone — could create and OVERWRITE objects in bucket paths that the
--     app builds predictably (payments/<institute>/<billing>/proof-…,
--     contracts/<institute>/…, child/<childId>/photo-…). Object-name
--     obscurity was the only wall, and the pentest already ruled it out as
--     access control.
--   * kiddy-public is publicly addressable BY DESIGN (brand logos the
--     marketing pages render for anonymous visitors), so public READ stays;
--     public WRITE does not.
--   * Contracts (draft + signed), subscription/child/<billing> payment proofs
--     and child/staff photos are sensitive classes. KID-745 had already
--     documented the limitation ("no private/signed-URL flow exists"); this
--     migration is the infra half of replacing that limitation: a private
--     bucket + the let-the-server-mint-it model. The code half (uploads
--     through the server-only service-key client, signed-URL rendering,
--     existing-object migration for C2) lands with this task.
--
-- Why not row policies keyed on institute over a public bucket: storage
-- policies evaluate against the JWT, and the app renders branding for
-- anonymous visitors from the same bucket — keeping genuinely public assets
-- public and moving the sensitive classes out is the shape the remediation
-- asked for ("keep only genuinely public assets public").

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END $$;

-- The buckets. Idempotent upserts: a bucket the dashboard already created
-- keeps its row (ON CONFLICT DO UPDATE would need keys we cannot repair).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('kiddy-public', 'kiddy-public', TRUE, 10485760, NULL),
  ('kiddy-private', 'kiddy-private', FALSE, 10485760, NULL)
ON CONFLICT (id) DO NOTHING;

-- 1. Shut the anonymous door on storage.objects itself.
--    Supabase default privileges grant anon/authenticated on new tables; a
--    custom write policy over those grants is what makes anonymous overwrite
--    possible. Revoke the grants, re-grant ONLY what the intended policy
--    needs, and drop every policy that relied on the old grants. The
--    service_role keeps Supabase's own grants (and BYPASSRLS) so the storage
--    service and lib/storage.ts keep working untouched.
REVOKE ALL ON ALL TABLES IN SCHEMA storage FROM anon, authenticated;
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT SELECT ON storage.objects TO anon, authenticated;

-- Public (`TO public`) grants resolve to every role including anon — they
-- must go the same way as the explicit ones.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (roles::text ILIKE '%anon%'
            OR roles::text ILIKE '%authenticated%'
            OR roles::text ILIKE '%public%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- 2. The intended anonymous path, and only it: READ of the public bucket.
--    Marketing/portal branding reaches these through the public CDN URL, so
--    this policy is belt-and-braces for API access. No INSERT/UPDATE/DELETE
--    policy exists afterwards for any non-service role — anonymous storage
--    writes are impossible, full stop.
DROP POLICY IF EXISTS kiddy_public_anon_read ON storage.objects;
CREATE POLICY kiddy_public_anon_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'kiddy-public');

-- 3. The service role keeps its full path to BOTH buckets (uploads in
--    lib/storage.ts, signed-URL minting, GoTrue admin flows). Supabase ships
--    service_role policies on storage.objects; re-assert them so this file is
--    the one place that describes the intended access surface.
DROP POLICY IF EXISTS kiddy_service_all_access ON storage.objects;
CREATE POLICY kiddy_service_all_access ON storage.objects
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
GRANT ALL ON storage.objects TO service_role;
GRANT ALL ON storage.buckets TO service_role;
