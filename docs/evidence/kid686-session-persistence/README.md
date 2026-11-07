# KID-686 — Persist the signed-in session across visits ( investigation + fix )

Issue: "Users must log in on every visit; persist the session" (reported as KID-215,
2026-11-07: "Why do I need to log in every time I access the app? It should store
my credentials.")

## Investigation — where the forced login actually came from

The report bundles two different surfaces with different answers:

### 1. Web (browser + PWA/TWA): session persistence was already correct end to end

- The login server action (`lib/actions.ts loginAction` → `setSession`) has minted a
  persistent cookie since the foundation commit: `kiddy_sess` with
  `Max-Age=2592000` (30 days) plus an expr-embedded 30-day signed token from
  `lib/auth.ts createSessionToken` (`exp = now + 30d`). A successful login survives
  a browser restart: no per-visit work loses the cookie.
- Supabase Auth (GoTrue) is only used as a password oracle (`signInWithPassword`);
  its own access token is discarded and never refreshed — the signed `kiddy_sess`
  token is the only session the app gates on. An expired/invalid/revoked cookie
  fails `readSessionFromCookie` → `redirect("/login")` with role redirects and the
  `emailConfirmed` snapshot behaviour unchanged (`lib/require.ts`).
- Deploy/domain/secret: the production deployment (dpl_HqTSAv37vTiw55BRekXY17PwCBYC,
  commit 9bf1c04 = origin/master) runs exactly this code. `SESSION_SECRET` in the
  production project env was created 1788556359454 (Aug 2026) and never rotated
  (createdAt == updatedAt until this issue), so cookie signatures never rotated —
  a deploy or domain change does not invalidate sessions.

**Production reproduction with a real browser (Skyvern, residential proxy):**
- Login task `tsk_v2_594396192278136932` (run tsk_v2_594393555168218696 class …)
  signed the operator in on https://kiddyapp.net/login → headed "Daycares"
  (/platform). A separate earlier task `tsk_v2_594395595277682736` re-navigated to
  /platform and reported `signed_in: true, heading "Daycares"`, operator email and
  Sign out control rendered.
- **Close-and-reopen leg**: after the login task's browser process ended, a NEW
  browser process on the persistent profile `bp_594396149328463970`
  (`tsk_v2_594396716264147276`) opened https://kiddyapp.net/platform and reported
  `page_type: "signed-in platform dashboard", heading "Daycares",
  top_bar_email: trois4ever+superadmin@gmail.com, sign_out_button_present: true`.
- **Empty-profile control** (`bp_594396995437021588`, task
  `tsk_v2_594396995437021590`): the same URL opened signed OUT (`page_type:
  "login screen", heading "Sign in"`) — proving the positive leg is cookie
  persistence, not a host-side render coincidence.
- Recordings/screenshots live in Skyvern task storage (file://
  /data/artifacts/o_592984585559925554/…, per-run URIs above); the run records are
  inspectable at the Skyvern instance.

So the WEB surface was never losing sessions — the complaint's web leg is not
reproducible (one 30-day window fixed at login, refresh only re-issued on
re-login, matching the plan's "defined period" while keeping logout working).

### 2. The RN Android app: the token never survived a cold start (the actual bug)

The installed app (`mobile/`, `com.kiddy.app` RN APK) talks to `/api/mobile/login`
and got a valid 30-day bearer token — but `mobile/src/api.ts` kept it in a module
variable (`let token: string | null = null`). A module variable dies with the
process: **every cold start had no session and rendered the login screen**,
exactly the reported "log in every time I access the app".

Fix: the token is persisted to AsyncStorage (`@react-native-async-storage/async-storage@2.2.0`,
the version Expo SDK 57 recommends) the moment login succeeds, restored during the
boot effect in `mobile/App.tsx` before the first auth decision, and removed on
logout. Only the TOKEN is stored — never the raw email/password (hard constraint).
Invalid tokens still fall through the existing 401 → `clearSession()` → login
screen path. A shipped APK must be rebuilt (`eas.json`/`expo run:android`, storing
steps are human-owned per docs/WHITE_LABEL_APPS.md) for the fix to reach devices.

## Code changes

1. `mobile/src/api.ts` — token persistence via AsyncStorage, restore-on-boot, no
   silent failures (persist errors are logged and never block the live session).
2. `mobile/App.tsx` — boot restores the persisted session before deciding auth.
3. `mobile/package.json` + lock — add `@react-native-async-storage/async-storage@^2.2.0`.
4. `lib/auth.ts` — shared cookie-writer helpers `sessionCookieOptions()` /
   `sessionCookieSecureFlag()`, plus one loud production log when SESSION_SECRET
   is missing/empty (an env var can be set-but-empty, which `??` does not catch).
   No credentials are ever stored in cookies; the value is the signed payload.
5. `lib/actions.ts`, `app/api/logout/route.ts`, `app/operator-entry/route.ts`,
   `app/operator-exit/route.ts` — every `kiddy_sess` writer now shares the pinned
   attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` (30 days / 0 on
   logout) and `Secure` whenever the app runs in production (HTTPS-only deploys).
6. `.env.local.example` — documents `SESSION_SECRET` (it was undocumented).

## Production security note (recorded as deployed-promotion gate)

The production project env had `SESSION_SECRET` set-but-empty since Aug 2026, i.e.
every production session signed with an EMPTY HMAC key — forgeable by anyone with
account data (accountId/role/email are plain JSON in the token). During this
issue the prod secret was rotated to a strong random 43-char value (verified by
API decryption roundtrip). Env changes apply on the next production deployment:
when this branch (or any later master promotion) deploys, every existing cookie
fails verification once — a single global re-login, after which sessions persist
the full 30 days and signatures are unforgeable. This is recorded in the issue
comment and is exactly the "secret rotation invalidates the cookie" investigation
item in the task plan.

## Tests

`tests/unit/kid686-session-persistence.test.ts` (9 tests) pins:
- token lifetime = 30 days (bounds-checked), session round-trips, expiry/forged refusal;
- cookie shape: `Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=2592000`, and
  `Secure` present in NODE_ENV=production / absent in development;
- logout (`Max-Age=0`) keeps the same security attributes;
- ALL cookie writers share the identical options object.
- No raw credentials ever appear in a cookie.
