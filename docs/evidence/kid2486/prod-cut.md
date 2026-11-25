# KID-2486 — production cut record (center settings cleanup)

Status: **complete — the production Worker is cut, deployed and verified.**

The staging build and its EN/AR verification live in `README.md`. This record
covers the production cut only.

## Approval

The founder accepted the human-only confirmation card
`117dbf08-5ea7-4f7e-983a-c85be2237160` ("Founder sign-off: center settings on
staging") on **2026-11-25T17:50:10Z**. Accept meant "release to production".

## What shipped

Cherry-picks from `staging`:

- `c17eb52` — KID-2486: remove the app-language card from center settings;
  render the center name read-only and never write it from
  `saveCenterDetailsAction`; drop the duplicate "Daycare name" field from
  Branding; add the platform-only rename form (`updateDaycareNameAction`,
  audited, branding cache purged). Equivalent to staging `796c7c1`.
- `22b8152` — KID-2486: staging EN + AR verification evidence. Equivalent to
  staging `820dee1`.

| Item | Value |
| --- | --- |
| Pull request | #131 `kid2486-prod-cut` → `master` |
| Merge commit | `8b49f07` (2026-11-25T18:01:17Z) |
| Worker | `kiddy-web` version `d349c0e6-5429-4fe8-ae98-ec7842116df5` (2026-11-25T18:04:43Z) |
| Deploy message | `KID-2486-center-settings-master-8b49f07` |
| Previous worker version (rollback) | `8ba54e27-29a7-4e6c-9954-ef1ec00abb0b` (KID-2476 build, 2026-11-25T14:55Z) |
| Routes / DNS | unchanged |
| Migrations | none |
| Env / secrets | none |

The deploy is additive: only the Worker script version changed. Worker
secrets, the Hyperdrive binding, the cron trigger and zone routes were not
touched.

### Build inputs

The same public values as the previous production build:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — public value already present in the
  live layout chunk
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key from the production env
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `KIDDY_CSP_MODE=report-only`
- `SESSION_SECRET` — build-only boot check; the Worker keeps its runtime secret

Deploy method: `npx opennextjs-cloudflare build` on `8b49f07`, then
`npx opennextjs-cloudflare deploy --message KID-2486-center-settings-master-8b49f07`
(top-level Worker environment).

## Verification on the cut tree

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx eslint` on the five touched source/test files | clean |
| `npx vitest run tests/unit/kid2486-center-settings.test.tsx tests/unit/kid489-instapay-payment-link.test.tsx` | 28/28 pass |
| CI on PR #131 (`Test + build + wrangler dry-run`) | pass |
| CI on PR #131 (`audit`) | pass |
| Vercel `kiddy` and `kiddy-staging` checks | pass |

The KID-2486 suite pins the contract without a browser:

- the settings page does not mount the language card;
- `saveCenterDetailsAction` ignores a tampered `name` and saves the other
  fields;
- `saveBrandingAction` cannot rename the center;
- `updateDaycareNameAction` refuses a blank name, refuses a non-operator, and
  writes/audits a valid rename with the EN/AR key parity check.

## Live production verification

### HTTP smoke (anonymous)

| URL | Result |
| --- | --- |
| `/` | `200`, `server: cloudflare`, `x-opennext: 1` |
| `/login` | `200` |
| `/portal/settings` | `307 → /login` (route exists and stays auth-gated) |
| `/platform` | `307 → /login` |
| `/child` | `307 → /login` |

Served layout chunk: `layout-998b8bf62e2bafd3.js` (new build; the previous
KID-2476 build served `layout-b9b001025e95fe32.js`).

### Platform surface (live, platform operator, EN + AR)

Real Chromium at 1440x1000 against `https://kiddyapp.net`. The operator signed
in with the production platform account.

| Locale | Center rename inputs | "Save name" buttons | `lang` / `dir` |
| --- | --- | --- | --- |
| EN | 2 (one per tenant row) | 2 | `en` / `ltr` |
| AR | 2 | 2 (`حفظ الاسم`) | `ar` / `rtl` |

Tenant names read from the live inputs: `Sunshine Daycare`, `Maple Grove
Daycare`. Captures: `prod-en-platform-center-name.png`,
`prod-ar-platform-center-name.png`.

### Deployed script contains the change

Fetched the live Worker script
(`GET /accounts/…/workers/scripts/kiddy-web` → 35,780,870 bytes, sha256
`80a498dbce698f750117c33d850efc3cc67054fd5a4aceb6f468162452d85eed`) and
checked the strings the cut introduced:

| Check | Result |
| --- | --- |
| `centerNameLockedHint` EN | present: "Your center name is set by the platform team. Contact support to change it." |
| `centerNameLockedHint` AR | present (unicode-escaped): "اسم مركزك تحدده إدارة المنصة. تواصل مع الدعم لتغييره." |
| `settings.centerNameLockedHint` render reference | present |
| Platform `Save name` label | present |
| `updateDaycareNameAction` path/audit strings | present |

The removed field is gone from the settings render path; the legacy
`settings.daycareName` dictionary key is unused (kept only to avoid churning
the shared dictionary in this cut).

### Center-admin surface on a local production build of this tree

The runner has no production **owner** credential (only the platform operator
and a staff fixture are granted), so the center-admin surface — which is
admin-only — was exercised on a local production build of the exact merge
commit `8b49f07` (`next start` with the seeded SQLite dataset), the same method
used by the accepted KID-2467 and KID-489 QA records. The deployed script
check above proves the cut is live in production.

Seeded owner: `trois4ever+admin@gmail.com` (local seed credential, not a
production credential).

| Locale | Name fields | `readonly` | Opacity | App-language card | "Daycare name" field | Locked hint | `lang` / `dir` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EN | 1 | yes | 0.65 | 0 | 0 | 1 | `en` / `ltr` |
| AR | 1 | yes | 0.65 | 0 | 0 | 1 | `ar` / `rtl` |

Captures: `localprod-en-center-settings.png`,
`localprod-ar-center-settings.png`.

### Tamper rejection (server side, end to end)

On the same local production build: removed `readonly` in the DOM, set the
field to `TAMPERED NAME`, submitted **Save center details**, reloaded.

```json
{ "before": "Sunshine Daycare", "after": "Sunshine Daycare",
  "persistedTamper": false, "unchanged": true }
```

The stored `institute.name` is unchanged — a tampered center-admin POST cannot
rename the center.

### Platform rename is the single writer (end to end)

On the same local production build, signed in as the platform operator,
renamed the tenant through the new per-row form, then restored it:

```json
{ "orig": "Sunshine Daycare", "after": "Local Rename Check",
  "restored": "Sunshine Daycare", "restoredOk": true }
```

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| No language section on center settings; account-level language still works | pass — card is absent; `/switch-app-lang` still switches the account (used for the AR captures) |
| Center name read-only for center admins and server-rejected if tampered; editable from the platform view | pass — `readonly` + dimmed in the UI, tamper ignored by the action, live platform rename form |
| Only one name field in center settings; branding uses `institute.name` | pass — 1 name field, 0 "Daycare name" fields, branding reads `institute.name` |
| EN + AR verified; staging first; production cut gated on founder sign-off | pass — staging evidence in `README.md`, card accepted, live production platform check in EN + AR |

## Rollback

```sh
npx wrangler rollback --name kiddy-web
```

That returns the Worker to `8ba54e27-29a7-4e6c-9954-ef1ec00abb0b` (KID-2476).
No route, DNS, migration or secret change was made, so rollback is a script
version swap only.
