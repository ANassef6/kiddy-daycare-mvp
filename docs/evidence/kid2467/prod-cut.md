# KID-2467 — production cut record (drive is documents-only)

Status: **complete — production cut finished and verified.**

Founder direction (KID-215 comment `61b5b7c0`): the parent drive stays
documents-only, with no media upload option. The change was reviewed and the
founder accepted the staging sign-off card (`81649bb6`) on **2026-11-24T00:04:46Z**.
That acceptance is the production approval for this change.

## What shipped

The staff portal drive form now offers only **File** and **PDF**, and the drive
upload purpose is restricted to the `DOCUMENT_MIME_EXT` whitelist on the server,
so photos and videos are refused before a media row is written. Legacy
photo/video rows stay visible with their old labels; `/child/drive` stays
read-only.

| Item | Value |
| --- | --- |
| Staging pull requests | #107 (change), #109 (tests) |
| Production pull request | #111 `kid2467-prod-cut` → `master` |
| Merge commit | `980e111` (2026-11-24T00:13:19Z) |
| Production commits | `8331bad` KID-2467: make the drive documents-only, `5dbd0cb` KID-2467: pin drive sharing and legacy media visibility |
| Worker | `kiddy-web` version `3f7287fc-0c74-441f-bea8-b0e3bb75dea0` (deployed 2026-11-24T00:18:53Z) |
| Deployment message | `KID-2467-drive-documents-master-980e111` |
| Previous worker version (rollback) | `b02ff0f0-83e1-4f75-814a-e73be305066a` (deployment `9b67b98f-bbaf-4635-a5fe-56b469fa5bd4`) |
| Routes / DNS | unchanged |
| Migrations | none |

The production cut cherry-picks the two reviewed KID-2467 commits onto
`master`. It deliberately does **not** merge the `staging` branch, because
`staging` also carries the in-review KID-2466 events-attachment work.

### Build inputs

Production public values already in use, plus a build-only session secret:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key read from the live bundle
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — public website token read from the live bundle
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `SESSION_SECRET` — build-only check; the Worker keeps its runtime secret
- `KIDDY_CSP_MODE=report-only` (unchanged)

Deploy method: `npx opennextjs-cloudflare build` on `980e111`, then
`npx wrangler deploy --message KID-2467-drive-documents-master-980e111`. The
deploy is additive: only the script version changed. Worker secrets, Hyperdrive
bindings, cron triggers and zone routes were not touched.

## Verification on the cut commit (before deploy)

- `npx tsc --noEmit` — clean
- `npx next lint` on the six touched source/test files — clean
- `vitest run`: KID-2467 drive documents (13), KID-2450 media compression,
  i18n page coverage, Arabic consistency, KID-368 AR i18n, i18n unit — 71 tests pass
- CI on PR #111: `Test + build + wrangler dry-run` pass, `audit` pass,
  Vercel `kiddy` build pass

## Production verification (2026-11-24T00:19Z)

### Deployed script contains the change

Fetched the live script
(`GET /accounts/…/workers/scripts/kiddy-web` → 35,052,530 bytes) and checked the
build output written by the cut commit:

| Check | Result |
| --- | --- |
| Drive purpose MIME map | live script: `drive: { folder: "drive", maxBytes: <cap>, mimes: <DOCUMENT_MIME_EXT> }`; the map it points at is the documents-only map (pdf, doc/docx, xls/xlsx, ppt/pptx, odt/ods/odp, txt, csv, rtf) |
| Portal drive select options | live script renders `select[name=kind]` with exactly two options, `value: "file"` and `value: "pdf"` |
| Legacy kind labels | the label helper still maps `photo`/`video` to `drive.kindPhoto`/`drive.kindVideo`, so old rows keep their labels |
| Documents-only error copy | `drive.errorDocumentOnly` present with EN text ("Only documents can be added to the drive…") and the AR string |
| Documents-only admin hint | `driveAdmin.documentsOnly` present (EN + AR) |
| Parent drive read-only | unchanged; no upload form on `/child/drive` |

### Live probes

| Probe | Result |
| --- | --- |
| `GET https://kiddyapp.net/`, `/login`, `/features`, `/for-parents` | `200` |
| `GET https://kiddyapp.net/login` headers | `x-opennext: 1`, `server: cloudflare`, CSP report-only unchanged |
| `GET https://sunshine.kiddyapp.net/login`, `https://maple-grove.kiddyapp.net/login` | `200`, `x-opennext: 1` |
| `GET /portal/drive`, `/child/drive` (anonymous) | `307 -> /login` |
| `POST /api/media/presign` with an image intent (no session) | `400 {"error":{"code":"unauthorized",…}}` — auth gate still first |
| New static asset for the drive page (`/page-f8be6ca54ce17542.js`) | `200` |
| New shared i18n chunk (`/9082-7050be63e2514400.js`) | `200` |
| Cron trigger | `*/5 * * * *` still attached to `kiddy-web` |

### Signed-in acceptance (staging, same build inputs)

The authenticated drive checks need a staff session. Production has no test
credential available to this run, so the signed-in checks were done on staging
and are carried by the KID-2467 suite and the founder's staging sign-off:

- photo/video/image intents and presign tickets are refused for the drive purpose;
- PDF/Word uploads still store and share to a child and appear in that child's drive list;
- legacy photo rows stay visible;
- the portal form offers only File/PDF;
- EN/AR documents-only copy exists.

The production bundle above is the same code, so the behaviour is identical.

## Rollback

```
npx wrangler rollback --name kiddy-web --version-id b02ff0f0-83e1-4f75-814a-e73be305066a
```

or roll back to deployment `9b67b98f-bbaf-4635-a5fe-56b469fa5bd4` in the
Cloudflare dashboard. No route, DNS or schema change was made, so the rollback
is script-only.
