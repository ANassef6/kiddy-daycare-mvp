# KID-1178 — P1 security: headers/CSP, rate limiting, branding API (KID-1170 F-03 / F-06 / F-08)

Branch `kid1178-p1-security`, based on the KID-1176 Next.js 15.5.29 tree (PR #56) because the
CSP/header wiring depends on the upgraded framework. Owner-approved in KID-215
(2026-11-09: "Let's work on them all…").

## What shipped

### F-03 — baseline security headers + tailored CSP (Medium → done, rollout staged)

`next.config.mjs` now ships, for every route (`/:path*`), on HTML, API and static
responses alike:

| Header | Value |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `SAMEORIGIN` (legacy) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` |
| CSP | tailored policy (below), **report-only by default** |

CSP content: `default-src 'self'`, `frame-ancestors 'self'`, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, `worker-src 'self' blob:` (push service
worker), `report-uri /api/csp-report`, and app-specific origins taken from build
env — Supabase project origin + `*.supabase.co/.in` (img + connect, incl. `wss`
realtime), the Chatwoot widget host (script/frame/socket), and
`https://fcm.googleapis.com` (VAPID push service). `style-src`/`script-src`
carry `'unsafe-inline'` for the per-tenant inline theme tokens (which vary per
host, so a static hash cannot cover them) and Next's inline bootstrap scripts.
HSTS is intentionally NOT re-declared here: hosting already serves it, and a
duplicate could conflict.

**Rollout (staged as the plan requires):** the policy is delivered as
`Content-Security-Policy-Report-Only` by default; violations post to the new
`POST /api/csp-report` collector (logged with bounded fields, never persisted
verbatim, per-IP throttled at 60/min, fail-safe). Enforcement is an environment
switch, not a code change:

```
KIDDY_CSP_MODE=enforce   # set in the BUILD environment, then rebuild/deploy
```

The switch was verified end-to-end on the production build: enforcing build
serves the same policy under the real `Content-Security-Policy` header name.
Note: Next serializes `headers()` into the build manifest, so the mode change
ships with the next build — set it in the deploy env, don't expect a runtime
flip.

### F-06 — rate limiting / brute-force protection (Medium → done)

New `lib/rate-limit.ts`: one fixed-window counter engine behind a store
interface; the durable backend is **Upstash Redis over its REST API** (no client
dependency, works on serverless) wired via
`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`; without the env it falls
back to an in-process store (protects single-instance deploys). Store outages
**fail open** with a loud `KID-1178/F-06` log line — the platform never locks
everyone out because the gate broke (KID-199.3 posture). Identities are
sha256-hashed before they touch storage keys; every blocked decision logs one
structured line for monitoring.

Rules (constants in `RATE_LIMIT_RULES`, all tested):

| Surface | Budget |
| --- | --- |
| web + mobile login | 30 attempts / 5 min per IP **plus** per-account lockout: default 5 verified failures / 15 min → lock 60 s → 120 s → 300 s → 15 min cap (progressive); success clears the counter; **lockout refuses even correct passwords** and the refusal never names the account state |
| forgot-password (`requestPasswordResetAction`) | 10 / 10 min per IP + 3 / 10 min per target email, uniform refusal |
| register (`registerAction`) | 10 / 10 min per IP, uniform refusal |
| confirm resend | 3 / 10 min per account |
| invite sends (`inviteParentAction`, `createParentLoginAction`, `sendInviteForContactAction`) | 20 / 15 min per admin account (admin-only surfaces; `resendParentInviteAction`/`resendActivationAction` keep their existing KID-111 `decideRateLimit` trail) |
| messaging (`sendMessage`/compose/replies/parent portal) | 30 / 60 s per account |
| uploads (branding, photos, proofs, drive, event media, newsfeed attachment) | 20 / 5 min per account |
| push subscribe | 20 / 5 min per account |
| push test | 5 / 5 min per account (each one is a real vendor push) |
| public contact form | 10 / 10 min per IP (outbound mail drives) |
| CSP report collector | 60 / 60 s per IP |

Uniform responses: auth surfaces return the same localized `security.rateLimited`
message (EN/AR dictionary keys, added in `lib/i18n.ts`); API routes answer
`429` + `Retry-After` with the JSON error shape the clients already parse
(mobile keeps its flat `{error}` body for app compatibility);
actions whose page form contract is redirect-only (messaging, uploads, invites,
contact, i.e. `Promise<void>` action props) bounce to the new localized
`/rate-limited` page (referer-checked safe back-link) instead of a silent
no-op.

### F-08 — public branding API (Low → done)

`GET /api/branding` keeps its response restricted to the six branding fields
(`name`, `logoUrl`, `brandImageUrl`, `primaryColor`, `accentColor`, `font`) —
no accounts, PII or secrets, and the per-host tenancy resolution (KID-683) still
applies. Added `Cache-Control: public, max-age=300, must-revalidate`
(browser-level only — deliberately no `s-maxage`, because the response is
host-dependent and a path-keyed shared CDN cache would stamp one tenant's brand
across another), error fallback holds the neutral Kiddy response with a 60 s
cache. Documented as intentionally public in the route header.

## Verification (all on this branch)

- `tsc --noEmit` clean; `next lint` clean (only the pre-existing KID-489 img
  warnings); `next build` green (report-only default AND the enforce build both
  reproduce); `db:verify-migrations` all passed (no schema change made — none
  needed).
- Full suite: **94 files / 1003 tests, all green**, including the 5 new
  KID-1178 files (34 pins):
  - `kid1178-rate-limit.test.ts` (12): window admits/limits/rolls over, per-key
    isolation, IP budget vs account lockout separation, escalating lock tiers
    clock-verified, success clears counters, case-insensitive account identity,
    hashed identities, XFF parsing, Upstash backend selection + REST pipeline
    commands + fail-open outage.
  - `kid1178-auth-throttle.test.ts` (5): `loginAction` and `POST
    /api/mobile/login` end-to-end on the seeded SQLite suite: 5 verified
    failures → locked, correct password refused while locked with the uniform
    message, colleague on the same IP unaffected, success clears the counter,
    IP budget fires 429 with `Retry-After`.
  - `kid1178-abuse-guard.test.ts` (3): messaging burst → `/rate-limited`
    redirect; push test 429 after 5 sends; push subscribe 429 after 20 writes
    (both with the JSON error shape).
  - `kid1178-security-headers-csp.test.ts` (12): every required header on the
    `/`-path rule, report-only default, enforce switch (incl. nonsense env →
    report-only), HSTS absence, CSP hardening + Supabase/Chatwoot/FCM origins.
  - `kid1178-branding-csp-report.test.ts` (6): six-field-only response, cache
    headers (+ no s-maxage), neutral fallback, and the CSP collector (bounded
    log fields, 400 on junk, IP-throttled).
- Production-build smoke (`next build` + `next start`, fresh SQLite):
  - `/login` HTML, `/brand-icon.svg` static and `/api/branding` all carry
    `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
    `X-Frame-Options: SAMEORIGIN` and the CSP (report-only name on the default
    build; enforcing name verified on an `KIDDY_CSP_MODE=enforce` rebuild).
  - `/api/branding` → `200`, `cache-control: public, max-age=300,
    must-revalidate`, body exactly `{"name":"Kiddy","logoUrl":null,…}`.
  - `/rate-limited` → 200; `POST /api/csp-report` → 204 with the structured log
    line `{"fmt":"KID-1178/F-03 csp-violation","directive":"script-src",…}`.
  - Mobile login: 5 wrong passwords → all `401`; the 6th (with CORRECT-looking
    input) → **429 + `retry-after: 60`** +
    `{"error":"Too many attempts. Try again later.","code":"rate_limited"}` and
    the monitor lines `account-failure-threshold` / `account-lockout`.

## Rollout runbook for enforcement (next deploy after this one)

1. Deploy this branch (CSP report-only is active).
2. Watch the prod logs for `fmt=KID-1178/F-03 csp-violation` — expected real
   noise is limited to the inline theme/Next script sources already allowed;
   anything else is a genuinely blocked feature to evaluate.
3. Set `KIDDY_CSP_MODE=enforce` in the build environment, redeploy.
4. Smoke login, the Chatwoot widget, a branding image and the push test card.

## Honest notes / follow-ups

- `'unsafe-inline'` for `script-src` stays until the report-only phase proves
  the real page set; tightening to nonces (Next middleware + `applyCSPHeader`)
  is the documented follow-up and is unlocked by the violation data.
- Third-party origins come from build-time env; builds without
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_CHATWOOT_BASE_URL` rely on the
  `*.supabase.co`/`*.supabase.in` wildcards only (Chatwoot unserved — feature
  off anyway when its env is unset).
- Per-IP identity takes the first `X-Forwarded-For` entry (the proxy-set
  client); the memory store is per-instance, so multi-instance deploys should
  wire Upstash before counting on cross-instance consistency.
- The messaging/upload/push budgets are ceilings: a legitimate power user can
  reach them (then the `/rate-limited` page explains and offers a back-link);
  auth lockouts never block a first-time legitimate login.
