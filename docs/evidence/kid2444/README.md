# KID-2444 — Android v5: session persistence + push notifications

Founder report (KID-215, 2026-11-19T18:46Z): on the Android app he must log in
every time it opens, and notifications still do not arrive. The v4 APK is
`net.kiddyapp.sunshine` versionCode 4.

## What was actually broken (three separate causes)

### 1. Digital Asset Links never verified — the app was an unverified Custom Tab

`lib/twa.ts` published the certificate digest as **base64** of the raw SHA-256
bytes. Digital Asset Links only accepts **colon-separated uppercase hex**, and
rejects the whole file when any entry is malformed:

```text
Error: invalid_argument: Invalid android app asset descriptor
(malformed cert fingerprint): jOEoFBJf012w9mLcVtbz1eWj9xS8LCZWSD8wJj1QAb0=
errorCode: ERROR_CODE_MALFORMED_CONTENT
```

Evidence: [`assetlinks-da-api.txt`](assetlinks-da-api.txt) (Google
`assetlinks:check` + `statements:list` against production).

Android therefore treated the app as unverified. The v4 screenshot shows the
Chrome **Custom Tab** URL bar on a cold start:
[`v4-custom-tab-url-bar.png`](v4-custom-tab-url-bar.png). Play Services logged
the same failure: [`v4-da-verification-log.txt`](v4-da-verification-log.txt).

Consequences: browser chrome ("browser borders"), no TWA notification
delegation, no persistent TWA Chrome profile. This is also the KID-2443
full-screen root cause.

### 2. `/login` never resumed an existing session

The v4 app launches `https://sunshine.kiddyapp.net/login` on every cold start
(the KID-443 landing decision). The login page rendered the sign-in form even
when the 30-day `kiddy_sess` cookie was still valid — there was no session
check or redirect. The cookie was not lost; the UI simply asked for the
password again.

Production, pre-fix (same Playwright browser context, login then reopen
`/login`):

```json
{ "afterLogin": "https://sunshine.kiddyapp.net/child",
  "afterReopen": "https://sunshine.kiddyapp.net/login",
  "heading": "Sign in", "signInForm": 1 }
```

Evidence: [`prod-precut-login-check.json`](prod-precut-login-check.json),
[`prod-precut-02-reopen-login.png`](prod-precut-02-reopen-login.png).

### 3. The push card showed "enabled" without a real subscription

`components/PushNotificationsCard.tsx` treated
`Notification.permission === "granted"` as "subscribed". Chrome can keep the
permission while the push subscription is gone (browser data cleared, browser
update, unsubscribed elsewhere), so the card hid the Enable button and no
notification could arrive.

Production check with a granted permission and no subscription: the card said
`الإشعارات الفورية مفعّلة لهذا الجهاز` ("push notifications are enabled for
this device") while `pushManager.getSubscription()` returned `null` — see
[`push-check.json`](push-check.json) and [`push-settings.png`](push-settings.png).

## Fixes (staging branch, commit `b1d7dce`)

1. **`lib/twa.ts`** — publish the release and Play App Signing fingerprints as
   colon-separated uppercase hex. The format and derivation are documented in
   [`docs/TWA_ASSETLINKS.md`](../../TWA_ASSETLINKS.md).
2. **`app/login/page.tsx`** — when a valid session cookie is present, `/login`
   redirects to the role home (`/child`, `/portal/dashboard`, `/platform`) or
   `/change-password` for a temp-password account, exactly like `loginAction`.
   Guard notices (`?error=…`, `?confirmed=1`) still render and cannot loop.
3. **`components/PushNotificationsCard.tsx`** — "enabled" now requires an
   actual `PushManager` subscription; permission-without-subscription shows the
   Enable action again.
4. **Android v5** — same package (`net.kiddyapp.sunshine`), same release
   keystore, versionCode **5** / versionName **5.0.0**, carrying the v4 fixes
   (INTERNET permission, full-screen app-owned WebView fallback, retry and
   renderer-crash recovery, diagnostics) plus a `CookieManager.flush()` on
   pause so the 30-day session cookie is durable on the fallback path too.

## Staging verification (login persistence)

On `https://kiddy-staging-orcin.vercel.app` (branch `staging`), the same login
then reopen leg now lands on the parent home:

```json
{ "afterLogin": "https://kiddy-staging-orcin.vercel.app/child",
  "afterReopen": "https://kiddy-staging-orcin.vercel.app/child",
  "heading": "My children", "signInForm": 0 }
```

Evidence: [`staging-login-check.json`](staging-login-check.json),
[`staging-02-reopen-login.png`](staging-02-reopen-login.png).

Staging has no VAPID keys (`GET /api/push/public-key` returns `""`), so the
push end-to-end send runs on production after the cut.

## Tests

```text
npx vitest run tests/unit/kid443-assetlinks.test.ts \
  tests/unit/kid2444-login-session-resume.test.tsx \
  tests/unit/kid2444-push-subscription-state.test.ts
→ 3 files / 17 tests passed
npx tsc --noEmit → clean
next lint → 0 errors (pre-existing <img> warnings only)
```

## Android v5 artifact

```text
package       net.kiddyapp.sunshine
versionCode   5
versionName   5.0.0
minSdk        24, targetSdk 36
signer        CN=Kiddy Release … SHA-256 8ce12814…01bd (same as v4)
sha256        87729f8aa1bcf843e2e1444fb7e7a09004a1b3fd45141c938324da4c6cf25cfa
```

Fallback (no Chrome/Custom Tabs provider) cold-start proof on a pixel4 /
Android 10 with Chrome disabled: no URL bar, full-screen `/login`
([`s1-01-fullscreen-login.png`](s1-01-fullscreen-login.png)).

## Production gate (founder approval)

This is a web deploy only: assetlinks format, `/login` resume, push-card state.
No secret or VAPID change. After approval and deployment:

1. Google `assetlinks:check` must return `linked: true` for
   `net.kiddyapp.sunshine` on `sunshine.kiddyapp.net`.
2. Appetize v5 TWA cold start: no browser URL bar.
3. Login once, force-stop, reopen: still signed in.
4. Enable notifications (one tap), send the test push, background the app:
   notification arrives while the app is closed.
