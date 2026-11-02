# SUNSHINE_TWA_BUILD.md — signed Sunshine Daycare test APK (KID-440)

Recipe that produced the signed, installable Sunshine Daycare APK delivered on
Paperclip issue KID-440 via **@bubblewrap/cli** (Trusted Web Activity wrap of
the production Sunshine PWA). This does NOT touch any signing config or code in
this repo — everything happens outside the repo except this document. Play
Store publishing remains a human-owned step (see `WHITE_LABEL_APPS.md`).

## What the APK is

- **Package/applicationId:** `net.kiddyapp.sunshine` (daycare-specific, per the runbook namespace rule)
- **App name:** `Sunshine Daycare` (launcher label: `Sunshine`, because Bubblewrap caps launcher names at 12 chars)
- **Launch URL:** `https://sunshine.kiddyapp.net/` (the production Sunshine tenant, not generic Kiddy)
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
- **assetlinks.json not yet published** on sunshine.kiddyapp.net — deep-link
  fingerprint verification (`.well-known/assetlinks.json`) is the follow-up
  config step from `WHITE_LABEL_APPS.md` step 7; the install prompt still
  works without it (browser may show a permission sheet on first use).
