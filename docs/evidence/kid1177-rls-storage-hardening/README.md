# KID-1177 — P1 security: Supabase RLS and storage hardening (F-02)

KID-1170 finding F-02 remediation. Files of record:

- `supabase/migrations/0040_kid1177_rls_hardening.sql` — the RLS decision
- `supabase/migrations/0041_kid1177_storage_hardening.sql` — the storage decision
- `lib/storage.ts` — the server-only service-key storage layer
- `supabase/verify-migrations.mjs` — runtime probes of both decisions
- `tests/unit/kid1177-rls-storage.test.ts` — ledger + audit + semantics pins
- `scripts/migrate-sensitive-objects.ts` — C2: moves the existing objects
- Adapted flow tests: kid489 / kid737 / kid745 / kid746 / kid850
- `tests/helpers/kid1177-storage.ts` — shared service-client stand-in

## The recorded model

Database (0040):

- **Deny-by-default RLS** on every app table, enabled DO-block style over the
  live schema so future tables are covered without editing the migration. No
  permissive policy exists on any app table — a non-owner role reads and
  writes nothing.
- The app's own `pg` connection (KIDDY_DATABASE_URL) **owns the app tables**
  — the same role applied migrations 0001–0039 through the `schema_migrations`
  ledger — and table owners are exempt from RLS, so production data access
  continues working unchanged. This was verified on this clone with a full
  migration replay (green) and the app's SQLite fallback is unaffected.
- **FORCE RLS is deliberately not used** — the owning role IS the app today;
  forcing would deny the app itself. The threat here is every OTHER role
  (anon, authenticated, an exposed PostgREST, a future client query path).
- Grants: `REVOKE ALL` on tables and sequences in the app schema from
  `anon`/`authenticated`, plus `ALTER DEFAULT PRIVILEGES` revokes so future
  Supabase-style auto-grants do not reopen the door for tables this
  connection creates. Exactly one intended path stays open:
  `GRANT INSERT ON contact_request` (the 0003 lead policy's table privilege).
- Not chosen: per-row institute policies keyed on a session context variable.
  The app never connects as a non-owner role today, so those policies would
  be untested dead SQL; the honest forward model is documented in 0040's
  header — when a real client query path is added, its policies get written
  and tested then.
- service_role keeps Supabase's BYPASSRLS; it cannot be meaningfully denied
  at the policy layer. Its compensating control (key server-only) is pinned
  by the audit test below.

Storage (0041):

- `kiddy-public` stays publicly READABLE by design (branding the marketing
  pages render for anonymous visitors) but is no longer writable: the
  migration revokes every anon/authenticated grant on `storage.objects`, and
  drops every policy that granted them (or `public`) anything — including the
  custom anonymous WRITE policy the old anon-key uploads depended on. The
  only remaining non-service policy is `kiddy_public_anon_read`
  (`FOR SELECT ... USING (bucket_id = 'kiddy-public')`).
- `kiddy-private` bucket (10 MB cap) is created for every sensitive class:
  payment proofs (`child_billing`, `daycare_invoice`), contract drafts +
  signed snapshots (`daycare_contract`), child and staff photos. Publicly
  addressable by nobody; reads happen only through short-lived service-key
  signed URLs minted in already-authorized render contexts.
- Buckets are idempotent upserts — a bucket existing under the same id keeps
  its dashboard-set limits.

## The code change

- `lib/storage.ts` is the single server-only storage wrapper
  (`SUPABASE_SERVICE_ROLE_KEY`, memoized service client). All storage writes
  now ride it: branding stays in kiddy-public (public asset, service-keyed
  write); proofs, contracts, and photos go to kiddy-private and their rows
  keep the `kiddy-private:<path>` REF format instead of a public URL.
- Render sites resolve refs at render time in server contexts:
  `storageSrcFor` / `signedUrlsForRefs` (single + batch). Legacy stored URLs
  (pre-migration rows, seeded picsum, data: URIs) pass through unchanged, so
  the migration is linear: 0041 tightens access, uploads move to private from
  the first deploy, and existing rows migrate via the C2 script whenever the
  operator runs it (`npx tsx scripts/migrate-sensitive-objects.ts` with
  production env; per-object fail-closed ordering: download → upload → verify
  private copy → rewrite row → delete public object; safe to re-run).
- The settings/branding upload gate is now `storageAdminConfigured()` — an
  anon-key-only installation can no longer write storage at all (that is the
  point of 0041), so honest failure means a clear banner, not silent loss.

## Service-role key audit (acceptance criterion)

Static audit test (`tests/unit/kid1177-rls-storage.test.ts`, "the service-role
key audit") walks `lib/`, `app/`, `components/`, `scripts/`, `supabase/`,
`mobile/` and fails on any non-allowlisted `SUPABASE_SERVICE_ROLE_KEY`
reference. Allowlist = `lib/storage.ts` (this task) + the three pre-existing
GoTrue admin helpers (`invite-email`, `contact-notify`, `invoice-notify`) +
the two ops scripts. Additionally:

- the production build's client bundle (`.next/static`) contains **zero**
  references to the key name (checked post-build; server chunks reference the
  env NAME only — the value is runtime `process.env`, not bundler-inlined).
- no `use client` module imports `@/lib/storage`.
- `getStorageAdmin()` throws a loud, secret-free error when the envs are
  missing; the error message names the env vars without printing values.

## Runtime evidence (not just SQL-on-paper)

`supabase/verify-migrations.mjs` now (PGlite, real Postgres 17 engine):

- creates a minimal `storage` shim shaped like the real catalog with RLS
  enabled on `storage.objects`, so 0041's statements run unmodified;
- probes **as `SET ROLE anon`**: app tables denied (permission denied, not
  "empty"), the four tenant-critical tables by name (child, daily_report,
  message, push_subscription), `contact_request` insert ALLOWED and read
  DENIED, grants inventory = exactly the two intended contact_request
  INSERT grants, RLS-enabled state asserted per table;
- probes storage as anon: public bucket listable, private bucket resolves
  nothing, anon INSERT (a public-bucket write attempt!) fails with an
  actual denial and the probe writes nothing.

## SQLite note

The 0040/0041 decisions are Postgres-only by design: SQLite (the local dev
fallback) has no RLS and no storage layer. No mirror change was needed — the
mirror pins remain green (no new columns/tables). Honest limitation, same as
0019's ledger approach: the fallback database's access control stays at the
application layer and is doc-noted here.

## Gates

- `npx tsc --noEmit` — clean
- `npx next lint` — clean (pre-existing KID-489 img warnings only)
- `next build` — green (client bundle also contains no service-key name)
- `npm run db:verify-migrations` — all checks passed
- `npm test` — 96 files / 1053 tests green (includes the 19 new KID-1177
  pins + adapted kid489/kid737/kid745/kid746/kid850)

## What remains out of scope / operator follow-ups

1. Run `npx tsx scripts/migrate-sensitive-objects.ts` with production env to
   move the existing QA/production objects (uploads are private immediately
   after deploy; a migrated row renders from the private bucket the moment
   its object moves).
2. Supabase project settings: if PostgREST is exposed publicly, 0040 only
   helps after the migration is APPLIED on the project — apply by starting
   the app once (ensurePgSchema) or via the SQL editor.
3. objects created by roles other than the app connection (dashboard SQL
   editor) are outside this migration's auto-net; review their ownership if
   any exist.
