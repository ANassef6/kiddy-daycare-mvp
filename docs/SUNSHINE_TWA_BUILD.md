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
