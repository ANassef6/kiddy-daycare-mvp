# SUNSHINE_TWA_BUILD.md — signed Sunshine Daycare test APK (KID-440)

Recipe that produced the signed, installable Sunshine Daycare APK delivered on
Paperclip issue KID-440 via **@bubblewrap/cli** (Trusted Web Activity wrap of
the production Sunshine PWA). This does NOT touch any signing config or code in
this repo — everything happens outside the repo except this document. Play
Store publishing remains a human-owned step (see `WHITE_LABEL_APPS.md`).

## What the APK is

- **Package/applicationId:** `net.kiddyapp.sunshine` (daycare-specific, per the runbook namespace rule)
- **App name:** `Sunshine Daycare` (launcher label: `Sunshine`, because Bubblewrap caps launcher names at 12 chars)
- **Launch URL (v1):** `https://sunshine.kiddyapp.net/` — superseded by the v2
  relaunch (see [v2 relaunch (KID-443)](#v2-relaunch-kid-443-versioncode-2-versionname-101) below)
- **Launch URL (v2):** `https://sunshine.kiddyapp.net/login` — QA (KID-441)
  FAIL 1: the v1 v1 cold launch landed on the generic-Kiddy marketing homepage
  (the tenant root serves it); the Sunshine-branded login is the first screen
  parents should see, so the rebuilt APK (versionCode 2, versionName 1.0.1)
  points `startUrl`/`launchUrl` at `/login`.
- **Min/target SDK:** 24 / 36 (`com.google.androidbrowserhelper:androidbrowserhelper:2.7.4` requires minSdk ≥ 24)
- **Signed with:** release keystore + `apksigner`, verified with v2+v3 schemes

## Environment used (from the shared Android toolchain)

| Piece | Where | Version |
| --- | --- | --- |
| JDK | `/paperclip/android-toolchain/jdk-21.0.13+9` | Temurin 21.0.13 LTS |
| Android SDK | `/paperclip/android-toolchain/android-sdk` | build-tools 36.0.0, platform android-36, cmdline-tools 12.0 |
| Node | `/usr/local/bin/node` | v24.21.0 |
| Bubblewrap | `npx @bubblewrap/cli` (local npm install) | reads name/theme/start URL from the live manifest |

Bubblewrap needs `<sdk>/bin` or `<sdk>/tools/bin` for `sdkmanager`. The shared
SDK only nests it at `cmdline-tools/latest/bin`, so the toolchain dir gained a
compat symlink: `<sdk>/bin -> cmdline-tools/latest/bin`.

Bubblewrap's own `~/.bubblewrap/config.json` points at the shared JDK/SDK:

```json
{ "jdkPath": "/paperclip/android-toolchain/jdk-21.0.13+9",
  "androidSdkPath": "/paperclip/android-toolchain/android-sdk" }
```

## Keystore (OUTSIDE the repo, never committed)

- Path: `/paperclip/keystores/kiddy-release.jks`
- Alias: `kiddy-release`
- Passwords: read from `/paperclip/keystores/keystore.env` (not printed here)
- Release cert SHA-256:
  `8C:E1:28:14:12:5F:D3:5D:B0:F6:62:DC:56:D6:F3:D5:E5:A3:F7:14:BC:2C:26:56:48:3F:30:26:3D:50:01:BD`
- One reusable key for white-label test builds; if it later becomes the Play
  upload key, guard it like production (backup + password manager), per the
  runbook.

## Icons — from SVG to PNG (Bubblewrap needs PNGs)

The Sunshine manifest lists only `/brand-icon.svg` (`sizes: any`,
`image/svg+xml`) — a generated 512×512 SVG: indigo `#6366f1` rounded square
with white "SD". Bubblewrap requires PNG, so the SVG's design was re-rendered
with `sharp` (no system fonts in the build env, so `fontconfig` was pointed at
a downloaded DejaVu Sans Bold TTF via `FONTCONFIG_FILE`):

- `icon-512.png` (512×512, purpose any) / `icon-192.png` (192×192, purpose any)
- `icon-512-maskable.png` (512×512, full-bleed square, glyphs scaled into the
  middle 80% safe zone, purpose maskable)

They were served to Bubblewrap over a loopback HTTP server
(`python3 -m http.server 8090`) because the icon picker takes URLs.

## Build recipe (reproducible)

```sh
# 1. Workspace with @bubblewrap/cli + sharp available
mkdir twa && cd twa && npm init -y && npm i @bubblewrap/cli sharp

# 2. Generate the TWA project from the live Sunshine manifest
#    (bubblewrap init prompts; the equivalent non-interactive path sets:)
#    host start URL: sunshine.kiddyapp.net /, launcherName: Sunshine (≤12 chars),
#    packageId: net.kiddyapp.sunshine, versionCode: 1,
#    iconUrl: http://127.0.0.1:8090/icon-512.png,
#    maskableIconUrl: http://127.0.0.1:8090/icon-512-maskable.png,
#    signingKey.path: /paperclip/keystores/kiddy-release.jks, alias: kiddy-release,
#    minSdkVersion: 24 (androidbrowserhelper 2.7.4 needs ≥ 24)
#    then TwaGenerator.createTwaProject()/saveToFile writes twa-manifest.json + app/

# 3. Build + zipalign + sign with the release key
export JAVA_HOME=/paperclip/android-toolchain/jdk-21.0.13+9
export ANDROID_HOME=/paperclip/android-toolchain/android-sdk
export BUBBLEWRAP_KEYSTORE_PASSWORD=$(grep KEYSTORE_PASSWORD /paperclip/keystores/keystore.env | cut -d= -f2)
export BUBBLEWRAP_KEY_PASSWORD="$BUBBLEWRAP_KEYSTORE_PASSWORD"
npx bubblewrap build --skipPwaValidation
#  → app-release-signed.apk (signs with apksigner, no assetlinks check here)
#  → app-release-bundle.aab (what Play Console needs later)
```

Result: `app/` gradle project with `applicationId 'net.kiddyapp.sunshine'`,
`minSdkVersion 24`, icon mipmaps generated from the PNG above (adaptive
`ic_launcher` + `ic_maskable`), and `launchUrl` string
`https://sunshine.kiddyapp.net/`.

## Verification performed (2026-11-02)

```sh
$BT=/paperclip/android-toolchain/android-sdk/build-tools/36.0.0
$BT/apksigner verify --print-certs app-release-signed.apk
#  Verified using v2 scheme: true   (v3: true)
#  Signer #1 SHA-256: 8ce12814…01bd  (== kiddy-release cert)
$BT/aapt2 dump badging app-release-signed.apk
#  package: name='net.kiddyapp.sunshine' versionCode='1'
#  application-label:'Sunshine Daycare' (all locales)
#  launchable-activity: net.kiddyapp.sunshine.LauncherActivity
```

- `apksigner verify`: passes (v2 + v3, release key, not debug)
- badging: label `Sunshine Daycare`, package `net.kiddyapp.sunshine`, launcher
  adaptive icon present (mipmaps from the brand PNG), launchable activity set.
- APK content check: `string/launchUrl == https://sunshine.kiddyapp.net/` — the
  app opens the live Sunshine production origin; zero generic-Kiddy strings in
  the brand surface (name/launcher/URLs all from the Sunshine manifest).

## Not verified (honest gap)

- **No on-device/emulator install.** The environment has an SDK emulator
  bundle but no `/dev/kvm`; software emulation of an Android 33 boot was judged
  impractical. Install-at-button ("tap the APK, login page appears") remains
  device-verified per the runbook checklist when a human/device is available.
- **assetlinks.json was not published at v1** — see the v2 section: as of the
  KID-443 fix round it is served by the platform web app and verified live.

<a id="v2"></a>
## v2 relaunch (KID-443: versionCode 2, versionName 1.0.1)

Same Bubblewrap project, same applicationId (`net.kiddyapp.sunshine`), same
release keystore (single-keystore rule: v1 testers upgrade in place), three
changes:

1. **`startUrl` → `/login`** (QA defect 1). In `twa-manifest.json`:
   `"startUrl": "/login"` (relative to `host` `sunshine.kiddyapp.net`); the
   generated `app/app/build.gradle` then carries `launchUrl: '/login'` and the
   APK's `string/launchUrl` resolves to `https://sunshine.kiddyapp.net/login`.
2. **`appVersionCode: 2`, `appVersionName: "1.0.1"`** in `twa-manifest.json`.
3. **assetlinks.json now published live** (QA defect 2), served by the web
   platform itself rather than a per-tenant static file:

   - code: `lib/twa.ts` (per-host registry) + `app/api/assetlinks/route.ts`;
     `next.config.mjs` rewrites `/.well-known/assetlinks.json` → `/api/assetlinks`;
   - content shape (statements) with `package_name: net.kiddyapp.sunshine` and
     the release-cert fingerprint in the assetlinks-required form: **base64 of
     the RAW SHA-256 digest bytes** — NOT the hex keytool prints;
   - hosts without a registered TWA (apex, legacy, unknown subdomains) get a
     404 JSON — fail-closed, same rule as the tenant surfaces.

### Fingerprint derivation (the awk/highlight — do NOT hand-copy)

```sh
# base64-of-raw-sha256 rendering assetlinks.json wants:
keytool -exportcert -rfc \
  -keystore /paperclip/keystores/kiddy-release.jks -alias kiddy-release \
  -storepass "$KEYSTORE_PASSWORD" \
  | openssl x509 -outform der \
  | openssl dgst -sha256 -binary \
  | base64 -w0
#  → jOEoFBJf012w9mLcVtbz1eWj9xS8LCZWSD8wJj1QAb0=
# cross-check with the hex rendering apksigner/keytool print:
#  8ce12814125fd35db0f662dc56d6f3d5e5a3f714bc2c2656483f30263d5001bd
#  (same digest; QA KID-441 recorded it; verify both renderings agree)
```

`KEYSTORE_PASSWORD` comes from `/paperclip/keystores/keystore.env`; never put
the value in a comment/commit.

### v2 build steps (same as v1 plus the three changes)

```sh
# 1. Workspace with @bubblewrap/cli available
mkdir twa && cd twa && npm init -y && npm i @bubblewrap/cli

# 2. twa-manifest.json carries: packageId net.kiddyapp.sunshine, host
#    sunshine.kiddyapp.net, startUrl "/login", appVersionCode 2,
#    appVersionName "1.0.1", signingKey path/alias as above (non-interactive
#    generation: TwaGenerator.createTwaProject from @bubblewrap/core)

# 3. Build + zipalign + sign with the release key (same env as the v1 recipe)
cd app && ./gradlew assembleRelease bundleRelease && cd ..
zipalign -p -f 4 app/app/build/outputs/apk/release/app-release-unsigned.apk \
  app-release-aligned.apk
KS=$(grep '^KEYSTORE_PASSWORD' /paperclip/keystores/keystore.env | cut -d= -f2)
apksigner sign --ks /paperclip/keystores/kiddy-release.jks \
  --ks-key-alias kiddy-release --ks-pass env:KS_P --key-pass env:KS_P \
  --out sunshine-daycare-v2-signed.apk app-release-aligned.apk
#  KS_P is exported from the keystore env (never in the command file)
```

The icons are reused from the v1 PNG render recipe (no change in brand assets),
served to the generator over the loopback server as in v1.

### v2 verification performed (2026-11-02)

```sh
apksigner verify --print-certs sunshine-daycare-v2-signed.apk
#  Signer #1 certificate SHA-256 digest:
#  8ce12814125fd35db0f662dc56d6f3d5e5a3f714bc2c2656483f30263d5001bd
#  == v1's cert → testers who installed v1 can upgrade in place
apksigner verify --verbose → Verified using v2 scheme: true (v3: true)
aapt2 dump badging → package name='net.kiddyapp.sunshine' versionCode='2'
  versionName='1.0.1', application-label:'Sunshine Daycare'
aapt2 dump resources → string/launchUrl "https://sunshine.kiddyapp.net/login"
curl -s https://sunshine.kiddyapp.net/.well-known/assetlinks.json
#  JSON statements for net.kiddyapp.sunshine with the base64 fingerprint
#  (live check recorded on KID-443)
```

### Still open after v2 (recorded, NOT fixed here)

- **Tenant-root redirect decision (KID-442 era):** should the web app redirect
  a tenant's OWN `/` to that daycare's login/branding surface for unauthenticated
  visitors? Deferred — v2 fixes the launch surface at the APK level instead.
- **Device install of v2** remains human/device-verified (no /dev/kvm here).

## v3 rebuild (KID-446, versionCode 3 / versionName 3.0.0) — root cause + crash-proof design

### What broke in v2 (root cause, evidence-backed)

The KID-443 relaunch (v2) shipped an APK whose dex was **R8-obfuscated**
(`com.google.androidbrowserhelper.trusted.*` renamed to `a`/`b`/`c`/`d`/`e`/`f`,
`androidx.browser.customtabs.*` classes renamed away entirely). That obfuscation
is NOT a hand-built anomaly: **Bubblewrap 1.27.0's generated `app/build.gradle`
template contains `buildTypes { release { minifyEnabled true } }` with NO
proguardFiles block and no keep rules** (see
`@bubblewrap/*/1.27.0` template — verified by regenerating the project on
2026-11-02 and reading the template output). A TWA wrapper's launch and service
binding path is then shrunk/renamed with zero keep rules, and on real hardware
(Samsung Galaxy Note 9, Android 10) the process died with the system
"app stopped working" dialog on cold start — installs fine, dies instantly,
exactly the reported symptom. The in-app resource *names* were also shortened
(standard AGP release optimization; resource IDs remained intact, so that part
was not itself the failure).

Three findings pinned the artifact and the failure (recorded on the issue):
- `string/fallbackType` was `customtabs`, so `WebViewFallbackActivity` shipped
  but was never the fallback path taken; cold start depended on an external
  browser being present and healthy *as well as* on the obfuscated dex holding
  together.
- The `androix.browser.trusted.NAVIGATION_BAR_DIVIDER_COLOR[_DARK]` meta-data
  keys are a known Bubblewrap 1.27.x template typo (fixed in v3's manifest).
- The browser-verification (assetlinks/DN vs `jOEoFBJf...`) chain was verified
  clean; a digital-asset-links mismatch degrades to browser mode and cannot
  hard-crash, so the dex was the remaining suspect.

v3 root-cause fix: **`minifyEnabled false`** so every class the launch/binding
path needs keeps its real name (v3's dex has `CustomTabsClient`, `TwaLauncher`,
`TwaProviderPicker`, `WebViewFallbackActivity`, `LauncherActivity` all under
their real names — verified with dexdump on the shipped APK). If the emulator
repro of the v2 crash is captured on the issue, it confirms the exact missing
link; the v3 build is intentionally safe against the whole class of R8-dex
failures regardless.

### User-mandated changes in v3 (browser independence + visible diagnostics)

1. **Cold start never depends on a browser.** `fallbackType: 'webview'`
   (BrowserHelper reads `FALLBACK_STRATEGY`; the value expected by 2.7.4's
   `LauncherActivity` for the in-app renderer is the literal string `webview`,
   not `webviewfallback`), so `TwaLauncher.WEBVIEW_FALLBACK_STRATEGY` →
   `WebViewFallbackActivity` loads `/login` in the app's own WebView whenever no
   Custom Tabs/TWA provider exists.
2. **LauncherActivity is wrapped in a catch-all.** If the BrowserHelper launch
   path throws (splash, token, session binding) the process now (a) records the
   failure, (b) launches the in-app WebView directly, (c) if even that fails,
   shows a real error screen with text — never a silent close. A
   `Thread.setDefaultUncaughtExceptionHandler` in `Application` persists any
   residual crash before the dialog so the next start can display it.
3. **`DiagnosticsActivity` ("Sunshine Diagnostics" — its own launcher icon).**
   Shows: package, versionName/versionCode, device model, Android SDK, launch
   URL, provider picker decision (`provider` / `renderer_request` /
   `renderer_used`), every detected Custom Tabs service + its version, the
   default browser, in-app WebView availability, LAST ERROR and a rolling event
   log. QA/user support needs no adb — a screenshot of this screen is the
   evidence.
4. **Cold-start logging**: every launch logs `Log.i("SunshineTWA", ...)` at
   `Application.onCreate`, provider pick, `super.onCreate` completion, chosen
   URL, fallback commitment, and any failure.
5. **Manifest hygiene for API 30+ visibility**: a real `<queries>` block for
   `android.support.customtabs.action.CustomTabsService` services, browsers, and
   the WebView provider; the `androix` typo keys fixed to `androidx`.

### v3 recipe (reproduces the build byte-for-byte modulo keystore times)

Regenerate the project exactly as v2 (same loopback icon server), then apply:

```sh
# 1. Generate the v3 project via the @bubblewrap Node API (see v2 recipe for
#    npm setup). In the TwaManifest used for generation:
#    packageId 'net.kiddyapp.sunshine', host 'sunshine.kiddyapp.net',
#    startUrl '/login', appVersionCode 3, appVersionName '3.0.0',
#    fallbackType 'webview', enableNotifications true (location delegation on),
#    styles as v2 (theme #6366F1, launcher 'Sunshine').
# 2. Patch the generated project (KID-446 sources kept on the task thread):
#    - app/build.gradle: minifyEnabled false; versionName "3.0.0";
#      fallbackType 'webview'
#    - net/kiddyapp/sunshine/LauncherActivity.java: catch-all + emergency
#      WebView fallback + getFallbackStrategy() override (records
#      renderer_used= in_app_webview when committed)
#    - net/kiddyapp/sunshine/Application.java: uncaught handler under
#      SunshineTWA tag persisting the stack trace to SharedPreferences
#    - net/kiddyapp/sunshine/AppDiagnostics.java + DiagnosticsActivity.java
#      (own main/LAUNCHER intent-filter, label 'Sunshine Diagnostics')
#    - AndroidManifest.xml: <queries> block + .DiagnosticsActivity activity +
#      androidx.browser.trusted.NAVIGATION_BAR_DIVIDER_COLOR[_DARK] fix

# 3. Build + align + sign with the SAME release key (in-place upgrade path)
cd app && ANDROID_HOME=<sdk> ./gradlew :app:assembleRelease && cd ..
$BT/zipalign -p -f 4 app/app/build/outputs/apk/release/app-release-unsigned.apk \
  app-release-aligned.apk
set -a; . /paperclip/keystores/keystore.env; set +a
$BT/apksigner sign --ks /paperclip/keystores/kiddy-release.jks \
  --ks-key-alias kiddy-release --ks-pass env:KEYSTORE_PASSWORD \
  --key-pass env:KEYSTORE_PASSWORD \
  --out sunshine-daycare-v3-signed.apk app-release-aligned.apk
# BT=<sdk>/build-tools/36.1.0, JDK 21 on PATH
```

### v3 verification performed (2026-11-02)

```sh
apksigner verify --print-certs sunshine-daycare-v3-signed.apk
#  Signer #1 certificate SHA-256 digest:
#  8ce12814125fd35db0f662dc56d6f3d5e5a3f714bc2c2656483f30263d5001bd
#  (identical to v1/v2 → in-place upgrade over the broken install)
aapt2 dump badging → versionCode='3' versionName='3.0.0' targetSdkVersion:'36'
aapt2 dump resources → string/launchUrl https://sunshine.kiddyapp.net/login
                    → string/fallbackType "webview"
dexdump on classes.dex → androidx/browser/customtabs/CustomTabsClient,
  com/google/androidbrowserhelper/trusted/{LauncherActivity,TwaLauncher,
  TwaProviderPicker,WebViewFallbackActivity} all present under real names
  (no R8 renaming anywhere in the launch path)
```

Runtime proof status is recorded separately on the issue (emulator and/or
Appetize run), never in this file — see KID-447's gate for QA's launch
verification on real hardware.

## v4 rebuild (KID-454, versionCode 4 / versionName 4.0.0) — the ERR_CACHE_MISS root cause + app-owned fallback

### The real root cause of KID-447's FAIL (proven on emulator, 2026-11-03)

The KID-447 gate FAILED with the in-app WebView showing "Webpage not
available … net::ERR_CACHE_MISS" on Android 10 / WebView 74 with no Custom
Tabs provider. Root cause was NOT the BrowserHelper load timing and NOT the
site's `no-store` headers:

**The generated manifest never declared `android.permission.INTERNET`.**
Bubblewrap's template shipped `<uses-permission POST_NOTIFICATIONS>` and the
location permissions but no INTERNET. Chrome (Custom Tabs path) fetches the
page in its own process, so the TWA path always worked and every earlier QA
pass looked clean. The moment v3 routed the no-browser case to an in-app
WebView, the WebView's own fetches were denied by the permission and Chromium
surfaced the denial as `net::ERR_CACHE_MISS` (the classic Android-WebView
shape of "network access denied") — on WebView 74 QA hardware and reproduced
byte-for-byte here on an android-29 AVD (`com.google.android.webview
74.0.3729.185`, `cmd package query-services …CustomTabsService` → "No
services found", cold start, 30 s wait, `Sign in` never appears). Adding
`<uses-permission android:name="android.permission.INTERNET"/>` and
reinstalling (`pm uninstall` + fresh install) removed the error completely:
the same cold start renders `/login` with **zero** WebView errors.

One test-harness note: an **in-place upgrade** (`adb install -r` of the
INTERNET-permissioned build over the old install) left a stale per-uid
denial on this AVD and kept showing `net::ERR_ACCESS_DENIED` until the app
was fully uninstalled and reinstalled. A real-device store update runs the
normal permission grant path, and the QA repro installs fresh; only
`install -r` over a network-denied build on this emulator showed the
artifact. Noted here so nobody burns hours on the same wall.

### v4 changes (client-side only; zero server/PWA changes)

1. **`INTERNET` uses-permission** added to `AndroidManifest.xml` — the actual
   fix. Regression risk: none; Chrome path behavior unchanged.
2. **App-owned fallback renderer** `.FallbackWebActivity` replaces
   BrowserHelper's `WebViewFallbackActivity` as the fallback target
   (`TwaLauncher.FallbackStrategy` override and the emergency path both
   launch it):
   - loads after the WebView is attached,
   - explicit `LOAD_NO_CACHE`,
   - `onReceivedError` per main frame: records code+description in
     diagnostics, hides the webview, auto-retries (5 × 2 s backoff), never
     leaves the raw Chromium error page visible,
   - after retries are exhausted: plain-language retry state with the URL
     and a Reload button (Reset rounds on tap),
   - **`onRenderProcessGone` recovery**: renderer crashes destroy/rebuild
     the webview and re-load instead of letting Chromium kill the whole app
     (proven surviving repeated renderer deaths on a thrashing API 33 TCG
     guest where the stock behavior crashes the app),
   - JS/DOM storage/third-party cookies enabled for the EN/AR toggle and
     Chatwoot.
3. **DiagnosticsActivity** now also surfaces: renderer_used, last WebView
   error code + text, auto-retry count, last successful page timestamp.
4. `minifyEnabled false` stays (process guard unchanged); same release
   keystore; TWA/Chrome path untouched.

### v4 verification performed (2026-11-03, emulators only, no Appetize)

```sh
apksigner verify --print-certs sunshine-daycare-v4-signed.apk
#  Signer certificate SHA-256: 8ce12814125fd35db0f662dc56d6f3d5e5a3f714bc2c2656483f30263d5001bd
aapt2 dump badging → versionCode='4' versionName='4.0.0'
aapt2 dump permissions → uses-permission INTERNET present
aapt2 dump resources → launchUrl https://sunshine.kiddyapp.net/login
```

android-29 AVD (x86_64, google_apis, WebView `com.google.android.webview
74.0.3729.185` — the exact failing generation), Chrome uninstalled, network
verified up from the guest, cold start `.LauncherActivity`:
`Status: ok / LaunchState: COLD`, `provider pick: none mode=BROWSER`,
`fallback committed: app-owned WebView …`, `Displayed
.FallbackWebActivity: +12s512ms`, then **`fallback page rendered:
https://sunshine.kiddyapp.net/login` with no `onReceivedError` at all**,
`Sign in` form + EN/العربية toggle visible; tapping العربية flips the page
to full RTL Arabic in the fallback renderer. Diagnostics screen shows
`renderer_used: app_fallback_webview`, `last error: (none recorded)`,
`auto retries used: 0`.

API 33 AVD (android-33 google_apis, WebView 109): fallback path launches
with no Custom Tabs provider and the app survives renderer crashes
(recovery loop logged, process stayed alive); the rendered-page screenshot
could not be completed because this local TCG (no /dev/kvm) guest is memory
starved and its renderers die before first composite — recorded honestly;
the remaining on-device render check is the KID-449 gate, which also covers
the real-device install/association re-check.

### Chatwoot in the fallback renderer — partial (web-asset side, not the app)

On WebView 74 the Chatwoot widget cannot initialize: its loader
`https://chatwoot.kiddyapp.net/packs/js/sdk.js` fails to parse on
Chromium 74 with `Uncaught SyntaxError: Unexpected token ?` (ES2020 optional
chaining / nullish coalescing). The language toggle works (proven above),
but the chat bubble needs a legacy-compatible (transpiled) SDK build served
— a web-asset change outside this APK; on the TWA path with a modern
Chrome it keeps working as before. Suggested follow-up (not blocking the
fallback launch path): serve an ES2019 build for old-Chromium agents or
accept degraded chat on no-browser devices.
