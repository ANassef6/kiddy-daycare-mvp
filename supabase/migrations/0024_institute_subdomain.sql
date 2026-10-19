-- KID-199.3r (KID-212): white-label wildcard subdomains.
--
-- Each daycare (institute) gets one URL-safe subdomain slug; the request
-- hostname's first label under the deployment's apex (PUBLIC_APEX_DOMAIN,
-- env-driven — never in code) resolves the tenant:
--
--   sunshine.<apex>  -> the institute whose subdomain = 'sunshine'
--
-- NULL stays legal (a daycare with no subdomain yet is simply not reachable
-- on any subdomain), which is also what legacy rows keep after this migration
-- runs — the backfill below gives them a best-effort slug derived from the
-- name. The partial unique index enforces one daycare per subdomain while
-- letting any number of NULLs coexist.
--
-- Slug shape matches lib/subdomain.ts normalizeSubdomainSlug: lowercase
-- [a-z0-9-], diacritics fold on the application side, capped at 50 chars so a
-- uniqueness suffix (-2, -3, ...) can never push a label past the DNS limit
-- of 63. Rows whose name produces no usable slug keep NULL rather than an
-- empty string, so the application can ask the operator for one.

ALTER TABLE institute ADD COLUMN IF NOT EXISTS subdomain TEXT;

-- Best-effort backfill from the name, deterministic on ties (created_at, id):
-- the first row keeps the bare slug, later duplicates take -2, -3, ...
-- base_slug is empty for names with no [a-z0-9] at all; those keep NULL.
WITH ranked AS (
  SELECT id,
         left(
           regexp_replace(
             regexp_replace(lower(trim(name)), '[^a-z0-9]+', '-', 'g'),
             '^(-)+|(-)+$', '', 'g'
           ),
           50
         ) AS base_slug,
         ROW_NUMBER() OVER (
           PARTITION BY left(
             regexp_replace(
               regexp_replace(lower(trim(name)), '[^a-z0-9]+', '-', 'g'),
               '^(-)+|(-)+$', '', 'g'
             ),
             50
           )
           ORDER BY created_at, id
         ) AS rn
  FROM institute
  WHERE subdomain IS NULL
)
UPDATE institute
SET subdomain = CASE WHEN ranked.base_slug = '' THEN NULL
                     WHEN ranked.rn = 1 THEN ranked.base_slug
                     ELSE ranked.base_slug || '-' || ranked.rn END
FROM ranked
WHERE institute.id = ranked.id
  AND institute.subdomain IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_institute_subdomain
  ON institute (subdomain)
  WHERE subdomain IS NOT NULL;
