# KID-1274 — CSP enforcement rollout + rate-limit proxy validation — evidence

Date: 2026-11-09. Source: KID-1179 `security-retest` residual actions 4 and 5.
Non-destructive: synthetic fixture data only (local SQLite + `/tmp` scratch). No production tenant data, no production changes, no master merge. CSP stays report-only in production — the owner gates the enforce flip.

## 1. What was verified and where

| Leg | Surface | Result |
|---|---|---|
| Report-only preview (KID-1272 build `dpl_557XFHDCEQzHJzR4oXgD9uwYLdJT`, `security-rc-integration` @ `b343fd0`) | `Content-Security-Policy-Report-Only` verified live on the deployed preview (login et al); collector `POST /api/csp-report` → 204 pre-KID-1274 and 429 + `Retry-After` under flood (see §3) | PASS |
| Violation collection architecture | Report-only CSP ships `report-uri /api/csp-report`; collector logs bounded fields only (`fmt:"KID-1178/F-03 csp-violation"`), never persists raw reports, throttled per IP (60/min) | PASS (code-verified + exercised) |
| Enforcing build (local production build, `KIDDY_CSP_MODE=enforce`, real origins baked) | Real-Chromium flow battery (below) — **zero CSP refusals, zero collector violations** across every flow | PASS |
| Enforcing build on the real Vercel platform (`kiddy-bwwpoxurf-kiddy2.vercel.app`, private unaliased deployment, no production impact) | 8/8 steps PASS: `/`, `/login`, `/rate-limited`, `/sw.js`, `/privacy`, `/welcome` all serve the enforcing `Content-Security-Policy` header; Chatwoot widget mounts and loads (28 requests through `https://chatwoot.kiddyapp.net`, zero refusals); real login-form attempt runs app-side paths with no CSP block | PASS |
| Rate-limit proxy trust (`clientIpFrom`) | See §3 | PASS (with a code-comment correction) |
| Durable backend (Upstash REST) | See §4 | PASS (multi-instance proven) |
| Thresholds / Retry-After / lockout / recovery | See §5 | PASS |
| Rollout runbook | [docs/evidence/kid1274-csp-rollout/README.md](./README.md) §6 switch + rollback exact steps | recorded |

## 2. Violation review (CSP) — what the app actually loads, and what the policy covers

Policy construction already derives third-party origins from build env (`next.config.mjs`), so the "tuning" step reduced to proving the real-origin set is complete against production's own runtime. Real origins were read from the production build's own public client artifacts and the Vercel project env (next-public values are public by design):

- **Next bootstrap**: same-origin `/_next/*` — covered by `'self'`.
- **Inline theme style**: root layout injects per-tenant `:root{--brand-primary…}` tokens inline (verified rendering inline on the enforcing build) — covered by `style-src 'unsafe-inline'` (residual gap in §7).
- **Supabase**: `https://sfetmfmtoubtdyyeyudd.supabase.co` (REST + realtime WSS + storage) — server-side API calls (GoTrue/REST/storage) bypass page CSP entirely (server-only module); the client-side surfaces still need coverage: the auth/confirm page's Supabase client (script/connect) and **browser-rendered storage images** (child/staff photos, payment proofs, contracts) load via `img-src` from signed `*.supabase.co` URLs — policy includes the project origin + `https://*.supabase.co`-style wildcard alternates when `NEXT_PUBLIC_SUPABASE_URL` is set at build time. Verified present in the enforcing build's served policy.
- **Chatwoot**: `https://chatwoot.kiddyapp.net` — script, widget iframe (`frame-src`), live-chat socket (`connect-src` + wss), avatars (`img-src`) — **exercised live under enforcing CSP: 28 third-party requests through the Chatwoot origin, zero blocks** (script `sdk.js`, widget assets, iframe mount). A `static.cloudflareinsights.com` beacon seen in the same session is emitted by the Chatwoot widget *inside its own cross-origin document*, governed by that document's own policy, not ours.
- **FCM/VAPID**: `connect-src https://fcm.googleapis.com` retained (defensive: server-side sends use it; browser-internal `pushManager` traffic is not page-CSP governed).
- **Push worker**: `/sw.js` served 200, `worker-src 'self' blob:` covers it; real-format `/api/push/subscribe` POST → 200 `{ok:true}` and `/api/push/test` → 200 `{ok:true}` from inside the enforcing build (see §5 for the headless-subscribe caveat).
- **Image routes**: `/brand-icon.svg` 200; `/_next/image` behaves as designed (400-by-design for SVG, optimizer for raster stays same-origin → `img-src 'self'`).
- **Export**: `/api/export?type=child` → 200 CSV under enforcing CSP.
- **Uploads**: carer `/portal/drive` multipart upload via the real server action — completed **with zero CSP refusals** (upload to storage degrades gracefully where storage env is not wired locally; the CSP-relevant loads are all same-origin).
- **Tenant routing**: `maplegrove.kiddyapp.net` / `bluehorizon.kiddyapp.net` driven through a host-shape forward proxy against the local enforcing build — tenant login via real server action lands on the tenant child-dashboard and renders the tenant brand (`Maple Grove Daycare`, `#2F855A`); API on tenant host answers 401 as designed. Also verified server-side over enforcing headers: `/api/branding?host` returns per-tenant branding; unknown hosts stay neutral `Kiddy` (KID-683 rule intact).

**Observed violation set at the end of the enforcing pass: EMPTY** — no `Refused to …` console lines, no `csp-violation` collector entries, across: login (web form + mobile API), portal surfaces, messages/notices/activities/push/billing, drive upload, image routes, export, sw.js, Chatwoot, tenant hosts, deployed-Vercel run. The report-only preview surfaced no additional first-party violations on its available (unauthenticated) surfaces.

### The headless-browser push caveat (honest note)
Chromium headless refuses web-push permission, so the *browser-internal* `pushManager.subscribe` step itself could not complete in this sandbox (error thrown by Chromium, not by CSP). The CSP-relevant parts — serving `sw.js`, `worker-src`, posting the real-format subscription to `/api/push/subscribe`, and the server-side test-push send with the real VAPID keys (delivered:0 on a synthetic subscription, graceful route) — all ran green on the enforcing build. The final on-device subscribe/delivery proof remains a production-QA item exactly as in KID-816; CSP cannot block `pushManager` because it is not a page resource.

## 3. Rate-limit proxy trust (`clientIpFrom`) — corrected invariant + empirical proof

- **Code-comment correction (this task's only source change):** the old comment claimed the real client value would be *appended* by the proxy to a spoofed first entry. That is nginx-style `proxy_add_x_forwarded_for` behavior and would make the first-entry read attacker-controlled. On the actual deployment platform the trust model is different and stronger: **Vercel overwrites `X-Forwarded-For` (and `x-real-ip`, `x-vercel-forwarded-for`) with the edge-observed connecting client IP and "do not forward external IPs … to prevent IP spoofing"** (vercel.com/docs/headers/request-headers). First entry = real client IP. Comment now states the true invariant and pins the deployment rule behind it.
- **Empirical proof on the preview edge:** 150 (cut at 93) POSTs to `/api/csp-report`, each carrying a *unique* random spoofed `X-Forwarded-For` + `X-Real-IP` pair. Spoofable-read would have produced 93 private buckets and never hit the 60/min budget; instead the shared per-IP bucket filled → **429 with `Retry-After: 46`**. The client-supplied headers never keyed the limiter. (The preview runs serverless with per-instance memory stores, so the exact crossing point varies; the discriminator — 429 must occur *at all* for a unique-spoofed stream — is valid.)
- **Deployment invariant recorded in the comment and the runbook:** Kiddy must keep running as the outermost edge; if a CDN/reverse proxy is ever placed in front of Vercel, `clientIpFrom` must be redone (Enterprise Trusted-Proxy topology) — otherwise every user collapses into one proxy-IP bucket.

## 4. Durable backend — Upstash REST behavior

- `rateLimitStore()` resolves `UpstashStore` iff `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set (env-wired, no client dependency); otherwise the in-process `MemoryStore` (**single-instance only** — documented in-file).
- Wire fidelity checked against the real Upstash REST shapes the store uses: `/pipeline` `[INCR|EXPIRE NX|TTL…, GET/SET/DEL]`, `/get/:key` → single `{"result":…}`, `/set/:key/:value?EX=`, `/del/:key`. A local Upstash-REST stand-in exercised every store path the limiter touches; counter keys observed in the store carry the `kid1178r:` prefix, hashed identities (sha256-prefix), and `:<window>w<bucket>` fixed-window suffixes — no emails/IPs in key space.
- **Multi-instance proof:** two *separate* `next start` server processes (different ports) both wired to the same REST backend; interleaved requests against `/api/csp-report` (60/min per IP) produced **30 allowed on instance A + 30 allowed on instance B = exactly the 60 shared budget, plus 429 + `Retry-After: 60` on both** — the counter is bucket-shared, i.e. serverless/multi-instance safe when the env pair is configured. Production wiring note in §6 (currently unset → production runs the per-instance fallback until the owner sets the pair).

## 5. Thresholds, Retry-After, progressive lockout, legitimate-user recovery (real HTTP, fixture data)

All against `/api/mobile/login` on two local instances with the shared durable store (same backends as production's path):

- **Per-IP attempt budget (30 / 5 min):** 30 × 401 then attempt 31 → **429 + `Retry-After: 300`**, uniform body `{"error":"Too many attempts. Try again later.","code":"rate_limited"}`; the refuser fires before any credential/DB work (first line of the route).
- **Per-account lockout threshold:** 5 wrong-password attempts → next attempt **429 + `Retry-After` (tier 1 = 60s)**; a *correct* password is refused while held (429, not logged in); lockout follows the hashed account identity across independent IPs (`Retry-After` identical for any IP).
- **Refusals inside a lockout do not count new failures** (peeks only) — observed live; reaching the next tier therefore requires the attacker to wait out each step (progressive backoff by design).
- **Progressive escalation to tier 2:** 10 counted failures inside the 15-min window → next attempt **429 + `Retry-After: 120`**. Server log lines show the escalation (`"rule":"account-failure-threshold","failures":10` → `retryAfterSec":"120"`). Higher steps (300s / 900s cap) follow the same code path (`backoffSteps: [60,120,300,900]`) and are pinned by unit tests.
- **Legitimate-user recovery:** waiting out the 60s step → correct password accepted (200 + account JSON + session token); immediately after, a single wrong attempt is back at plain **401** — the success path cleared the account counters (`authfail`/`authlast` keys gone from the store after success).
- **Collector budget:** `/api/csp-report` 60/min/IP → 204s then **429 + `Retry-After`** (seen at `Retry-After: 46` on the preview edge; exact value = remaining window TTL).
- **Fail-open posture:** with the REST backend unreachable, attempts fail *open* (401s flow, nothing wedges shut for the user) and each failure logs the loud monitor line `KID-1178/F-06 rate-limit store failure (failing open, monitor this): fetch failed` — on both the attempt-guard and the failure-record paths.

## 6. Production rollout runbook (owner-gated) — exact switch + rollback

> This runbook only flips CSP to enforcement. It deliberately stops short of doing so — enforcement is the owner's decision (KID-215 direction: fix everything; KID-1179: CSP rollout decision owner-gated).

**Precondition — fix the production env deltas BEFORE the next master deploy (found during this task):**
1. `KIDDY_DATABASE_URL` and the `postgres*` password slots in the project's production env store currently read back as **empty strings** (the running deployment still serves from the env snapshot baked at its creation, which is why production works today). The next deployment baked from the env store would boot without a database. Re-set `KIDDY_DATABASE_URL` (the Supabase pooler URL is referenced in `docs/evidence/kid1272-*/` + `/tmp`-staged pull is not persisted) before any redeploy.
2. `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are unset in production: rate limiting runs the per-instance in-process fallback, which is **not shared across serverless lambdas**. Set the pair (Upstash Redis REST) per the KID-1178 deploy runbook so thresholds/lockouts are global.
3. `KIDDY_CSP_MODE` must be set at **build** time (headers are baked into the build; *runtime* env alone is not sufficient).

**Switch (pre-approved staging steps already done):**
1. Set `KIDDY_CSP_MODE=enforce` in the **build** environment for production (Vercel project env, `target=production`), including in the **prebuilt** path if deploy uses one (`vercel build` reads the env from the project, or pass the env file).
2. Deploy the branch that carries this rollout (current holder: `security-rc-integration` @ `b343fd0` + this branch's comment fix; **not master**, no merge has happened here). `npx next build && next start` was already verified green in both modes (KID-1272) and the enforce mode was re-built/deployed/verified live in this task.
3. On the enforcing deploy, verify on the canonical domain: enforcing (not Report-Only) header + every referenced flow from §2 (login → tenant routing → portal surfaces → uploads → Chatwoot → push → image routes → export → `/rate-limited`). Anything refusing gets added to the policy **with its exact origin**, not by loosening the baseline (`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'` stay).
4. Watch for the first hours: `/api/csp-report` (204/429 — the collector keeps violations flowing while enforcing) and the app error logs; a real *blocking* violation shows as both a collector line and a user-visible breakage in the flow logs.

**Rollback (exact):**
1. Set `KIDDY_CSP_MODE=report-only` (or unset the var entirely — default is report-only) in the build environment **and rebuild/redeploy** (a runtime env tweak alone does NOT flip the header; buttons are baked). The enforcing miss is zero-risk because the Report-Only header carries the same policy + `report-uri`, so all observations keep flowing during rollback.
2. If the rate limiter itself is the emergency, clear the Upstash keyspace (prefix `kid1178r:` via Upstash CLI `DEL`/`FLUSHDB`) to drop lockouts without code changes; the limiter also falls open automatically if the store is unreachable.
3. If only the newest deployment is misbehaving, Vercel "instant rollback" re-promotes the previous deployment and re-bakes from ITS env snapshot — confirming the env variants rather than assuming "rollback implies older code" (see the DB-env precondition above).

## 7. Residual gap — `unsafe-inline` script/style and the nonce follow-up (recorded, not closed)

- `script-src 'self' 'unsafe-inline'` stays: App Router inline bootstrap + Server-Action hydration depend on inline scripts today; tightening to per-request nonces is a follow-up informed by exactly the flow set enforced above.
- `style-src 'self' 'unsafe-inline'` stays: the per-tenant theme tokens (brand color/font per host) are injected inline in the root layout; host-variance blocks a static hash. The nonce follow-up should carry both the bootstrap-script nonce pipeline and a theme-token extraction (inline style nonce or move `:root` tokens to a runtime-served same-origin `/theme.css` stylesheet).- Recording the follow-up here keeps it on the KID-1170/F-03 backlog: the policy is **enforceable and safe** while `unsafe-inline` remains, but the strongest anti-XSS posture waits until this closes.

## 8. Honest notes

- The enforcing build (local + deployed private URL) carries real third-party origins (Chatwoot + Supabase + apex) via the pulled *public* values only; no database, service-role key, chatwoot access token, or platform password was wired into any executing build or committed anywhere. Fixture data only (Maple Grove / Blue Horizon synthetic tenants).
- The deployed enforcing build (`kiddy-bwwpoxurf-kiddy2.vercel.app`) is a private unaliased deployment on the Kiddy Vercel project (baked enforce + real origins; no DB envs attached, so DB-backed legs were verified against the local production-mode build instead). It can be deleted by the owner or allowed to age out; it never received an alias and never touched `kiddy-*.vercel.app` production/preview aliases.
- Vercel's automation-bypass key from KID-1272 (`14dc2…`) was reused for preview fetches exactly as KID-1272 left it (its note says revocable) — the owner should rotate/revoke it once the enforce flip is complete.
- The full vitest battery, `tsc --noEmit`, and `next lint` were run on the resulting tree (KID-1178 rate-limit/CSP suites re-run focused during the loop too); every gate result and the log evidence referenced above is reproducible from this branch with the documented commands.
