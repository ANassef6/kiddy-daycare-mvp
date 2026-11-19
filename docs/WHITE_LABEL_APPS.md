# WHITE_LABEL_APPS.md — per-daycare white-label apps (KID-256)

## What ships in code

Every daycare is its own brand at its own subdomain (KID-199.3r / KID-212):
`sunshine.<PUBLIC_APEX_DOMAIN>` serves Sunshine Daycare and **only** Sunshine
Daycare. KID-256 makes that origin *installable as the daycare's own app*:

| Surface | Behavior |
| --- | --- |
| `GET /manifest.webmanifest` (any origin) | On a **known** daycare subdomain: `name`/`short_name` from the institute record (a bare name gets "Daycare" appended), `start_url`/`scope` `/` (relative → bound to that origin), `theme_color` = the daycare's brand primary, icons = the daycare `logo_url` first, then the generated fallback. On apex/legacy/unknown hosts: generic **Kiddy** manifest — unchanged. |
| `GET /brand-icon.svg` (any origin) | Generated fallback launcher icon: the daycare's initials (≤ 2 words) on its brand primary color, 512×512 viewbox. Always present, so a daycare without a logo is still installable and brand-colored. |
| Root layout meta | `theme-color`, `<link rel="manifest" href="/manifest.webmanifest">`, and `apple-touch-icon` (logo when uploaded, else the generated icon) all follow the host's brand via the same rule as `lib/theme.ts getBranding`. |

No install CTA is rendered in code yet (Chrome surfaces install prompts from
the manifest); anything apex-side stays generic by design. Unknown subdomains
never receive tenant branding — the same fail-closed rule as the rest of the
tenancy layer.

## What happens in code — and what does NOT

**Nothing here publishes to the Play Store.** Store packaging and publishing
are per-brand, human-owned steps (Google Play developer account, signing keys,
per-brand review cycles, store listing content). Code only produces the assets
the packaging consumes. Do not attempt publishing from automation.

## Runbook: packaging a daycare app for Google Play (Human-owned)

Prerequisites — **all human / account steps, not automatable from this repo:**

1. **Play Console developer account.** One per daycare brand: Google charges
   $25 per personal account / $25 once per organization, but each
   white-label app needs its own listing (and usually its own account or
   designated "aggregator" setup — decide with the operator). Searchability of
   "Sunshine Daycare" depends on THIS step happening per brand.
2. **Signing keys.** Per brand: `keytool -genkeypair -v -keystore
   <daycare>-release.jks -alias <daycare> -keyalg RSA -keysize 2048
   -validity 10000`. Store the keystore outside this repo (a keystores
   directory / password manager). Never commit `.jks` files or passwords.
3. **Per-brand review cycle.** Every Play submission goes through Google app
   review; budget days-to-weeks and schedule around the daycare's launch date.
4. **Store listing content.** Short/full description ("… daycare" copy the
   daycare approved), 512×512 launcher PNG, feature graphic 1024×500, privacy
   policy URL (use the daycare's tenant origin page or the platform page),
   category = Education / Parenting, contact email and phone the daycare
   controls — parents must be able to reach the daycare, not Kiddy.

### Packaging steps (Bubblewrap TWA) per daycare brand

1. Confirm the tenant is live: `https://sunshine.<apex>/manifest.webmanifest`
   returns the daycare's manifest (`JSON` above).
2. Install Bubblewrap: `npm i -g @bubblewrap/cli` (human-run, per workstation).
3. Build

   ```sh
   bubblewrap init --manifest https://sunshine.<apex>/manifest.webmanifest
   ```

   Bubblewrap reads name, icons, theme, and start URL from the manifest. When
   prompted:
   - **Package id**: `net.kiddyapp.<slug>` (e.g. `net.kiddyapp.sunshine`) —
     unique per brand, never reused, so two daycares cannot collide in the
     store namespace.
   - **App name / launcher name**: keep the manifest's `name` ("Sunshine
     Daycare") — do NOT edit toward "Kiddy"; the point of KID-256 is that
     searching "sunshine daycare" finds the daycare.
4. Icon/splash assets: Bubblewrap wants PNG. If the daycare uploaded an SVG
   only, render PNG exports of the generated
   `sunshine.<apex>/brand-icon.svg` (any SVG rasterizer → 512×512 launcher +
   splash sizes Bubblewrap asks for). Prefer the daycare's uploaded logo when
   one exists.
5. `bubblewrap build` produces `app-release-bundle.aab` signed with the
   brand's keystore; upload it to the brand's Play Console.
6. Play Store listing: app title ≤ 30 chars, e.g. `Sunshine Daycare`; lead
   description with the daycare's own words; add the daycare's region —
   Brazil/Egypt etc. — so local search ("روضة sunshine") finds it.
7. Asset-links verification: put the Bubblewrap-generated
   `assetlinks.json` content on the tenant origin route `.well-known` if the
   operator wants URL-origin verification (deep links) in the packaged app.
   This is a config step on the hosting deployment, not a code change each time.

### Asset-links fingerprint format (KID-2443 — do not regress)

`sha256_cert_fingerprints` MUST be colon-separated UPPERCASE SHA-256 HEX, for
example:

```json
"sha256_cert_fingerprints": [
  "8C:E1:28:14:12:5F:D3:5D:B0:F6:62:DC:56:D6:F3:D5:E5:A3:F7:14:BC:2C:26:56:48:3F:30:26:3D:50:01:BD"
]
```

Base64 of the same digest is **not** accepted. The platform published base64
from KID-443 through the v4 APK; Google's Digital Asset Links API returned
`ERROR_CODE_MALFORMED_CONTENT` ("malformed cert fingerprint") and Chrome logged
`Statement failure matching fingerprint`, so Chrome silently opened a Custom
Tab WITH a URL bar instead of the verified full-screen TWA. `lib/twa.ts` now
publishes hex, and the v5 APK's launch gate verifies the same statement before
handing off, so a future format regression falls back to the app-owned
full-screen WebView instead of showing browser chrome.

Derive the value from the signing keystore, never by hand:

```sh
keytool -exportcert -keystore <jks> -alias kiddy-release -rfc \
  | openssl x509 -outform der \
  | openssl dgst -sha256 -binary \
  | xxd -p -c 256
# insert ':' between every byte, uppercase
```

The server route is `https://<tenant>/.well-known/assetlinks.json` (rewritten to
`app/api/assetlinks`, registry in `lib/twa.ts`). Validate a deployment with:

```sh
curl "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https%3A%2F%2F<tenant>&relation=delegate_permission%2Fcommon.handle_all_urls"
# expect the statements array and NO "ERROR_CODE_MALFORMED_CONTENT"
```

### Per-daycare checklist (copy per brand)

```
Daycare: ______            slug: ______
[ ] Tenant live on https://<slug>.<apex>, manifest returns its name
[ ] Play Console account + active listing for THIS brand
[ ] Keystore generated, backed up, NOT in the repo
[ ] Package id net.kiddyapp.<slug> reserved (never reused)
[ ] Icons + listing assets exported from logo / brand-icon.svg
[ ] Submitted, review scheduled, approval communicated to the daycare
[ ] Install verified on a device: icon = daycare brand, name = daycare name
```
