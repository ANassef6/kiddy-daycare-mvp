# KID-2511 — production cut: 30 MB video cap

Status: **shipped to production on 2026-11-27.** Production Worker
`kiddy-web` serves version `b6edf96a`, built from `master` @ `118717d`
(PR #171). The previous version `77530d45` remains available as the rollback
target.

## Approval

| Item | Value |
| --- | --- |
| Approval card | `aa243800-07a7-4318-adc4-5eb83cda68bb` |
| Decision | approved by the founder, 2026-11-27T11:23:52Z |
| Supersedes | `c5212aab` (15 MB, approved 2026-11-27T06:20Z, one minute before the 30 MB direction) |

## Cut

| Item | Value |
| --- | --- |
| PR | #171 `KID-2511: raise video upload cap to 30 MB before production cut` |
| Merge commit | `118717d` |
| Merge method | merge commit into `master` |
| Cherry-picked commits | `6a4e784`, `c343225`, `0f36f53`, `728a78e` |
| CI | `Test + build + wrangler dry-run` pass (2m14s); `audit` pass (47s) |
| Build | `npx opennextjs-cloudflare build` exit 0 on `118717d` |
| Deploy | `npx opennextjs-cloudflare deploy --message KID-2511-video-30mb-master-118717d` |
| Deployed version | `b6edf96a-bdfe-4b58-9f38-1dd69c86d958` (2026-11-27T11:37:22Z) |
| Rollback target | `77530d45-6d3e-4385-b4fe-f2b4afebe9f9` |

The only docs conflict, in `docs/evidence/kid2487/README.md`, was resolved by
keeping `master`'s newer production evidence. No database migration, schema
change, secret change, or environment change.

## Build inputs

The production build used the same public values as the live Worker:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — the existing public website-inbox token
  (not recorded here)
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `KIDDY_CSP_MODE=report-only`

After the build, the new client bundle was checked before deploy:
`sfetmfmtoubtdyyeyudd.supabase.co` in 2 chunks, the Chatwoot token in 1 chunk,
`localhost:3000` in 0 chunks.

## Live production checks (anonymous)

| Check | Result |
| --- | --- |
| `/` | `200`, `server: cloudflare`, `x-opennext: 1` |
| `/login` | `200` |
| `/portal/newsfeed`, `/portal/events`, `/platform`, `/child` | `307 -> /login` (route exists, auth gate intact) |
| CSP header | `content-security-policy-report-only`, Chatwoot allowed |
| Served layout chunk | `layout-f3af184cf821e10d.js` (new build) |
| Chatwoot in new layout chunk | base URL and website token present; no `localhost` |
| Deployed script | 38,003,154 bytes, sha256 `dc1382f701fe6fa60fe6de577ab3fda839b195f9adaf600463d2a56fad3ba462` |

## Deployed script contains the change

Fetched `GET /accounts/…/workers/scripts/kiddy-web` and checked the strings the
cut introduced:

| Check | Result |
| --- | --- |
| `31457280` | present (5 occurrences) |
| EN "up to 30 MB" | present (4 occurrences) |
| EN "File is larger than" refusal | present (2 occurrences) |
| AR "حتى 30 ميجابايت" | present (3 occurrences, unicode-escaped) |
| Old `15728640` (15 MB) | absent (0 occurrences) |

## Boundary behaviour

The 30 MB accept/reject contract was verified on staging with an authenticated
owner session before the cut (see `README.md`): presign 30 MB -> `200` with
`maxBytes=31457280`; 30 MB + 1 -> `422 size`, for both newsfeed and event video;
photo ceilings unchanged; a real 20 MB `video/mp4` uploaded through R2 and
posted with a signed playback URL. This run had no production owner credential,
so the production leg reuses that accepted staging evidence plus the deployed
script proof above, the same method recorded for earlier production cuts.

## Rollback

If the live surface regresses, redeploy production Worker version
`77530d45` (`KID-2487-likers-tags-master-eaf2615`).
