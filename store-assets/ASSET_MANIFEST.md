# ASSET_MANIFEST.md — Google Play listing visual assets (KID-448)

Prepared for the Sunshine Daycare TWA Play listing (package `net.kiddyapp.sunshine`,
versionCode 2 / versionName 1.0.1, parent issue KID-442). **This is prep work only —
nothing was uploaded to any store account.**

## Asset provenance (chain of custody)

| Brand source | Detail |
| --- | --- |
| Live Sunshine brand SVG | `https://sunshine.kiddyapp.net/brand-icon.svg` (route in this repo: `app/brand-icon.svg/route.ts`) — indigo `#6366f1` square with white "SD" monogram, served 512×512 SVG |
| Brand palette | Live Sunshine layout CSS: `--brand-primary: #6366f1`, `--brand-accent: #f59e0b` (`theme-color` meta = `#6366f1`) |
| Wordmark / tagline | Sunshine web app title + tagline: "Sunshine Daycare — childcare, in your pocket" |
| Icon font | DejaVu Sans Bold — the same raster pipeline used for the shipped KID-440 launcher PNGs (rendered to glyph paths, no system fontconfig in the build env) |
| Login surface reference | EN/AR language toggle on `/login` (KID-443) is reflected as the EN/AR chips on the feature graphic |

Rendering pipeline: glyph outlines extracted with `opentype.js` from
DejaVuSans-Bold.ttf → SVG path data → rasterized with `sharp` (no alpha except the
adaptive foreground layer). Text is baked as vector paths, so the assets are
font-machinery independent.

## Assets

| File | Size (bytes) | Dimensions (px — PNG IHDR) | PNG color type | Purpose / source |
| --- | --- | --- | --- | --- |
| `play-icon-512.png` | 13,731 | 512 × 512 | 2 — RGB, **no alpha channel** | Play Store listing icon. Full-bleed square (no rounded corners — Play applies its own mask), Sunshine indigo + white "SD" monogram + subtle brand-tint corner circles. |
| `adaptive-icon-foreground-432.png` | 4,355 | 432 × 432 (108 dp at xxxhdpi, 4×) | 6 — RGBA (transparent background) | Adaptive icon foreground layer. White "SD" monogram centered; glyph bbox 213.9 × 113.5 px (corner radius from center = 121.1 px < 132 px) — inside the 66 dp safe zone circle (264 px diameter = 66/108 × 432). |
| `adaptive-icon-background-432.png` | 3,931 | 432 × 432 (108 dp at xxxhdpi, 4×) | 2 — RGB | Adaptive icon background layer. Solid Sunshine indigo `#6366f1`. |
| `feature-graphic-1024x500.png` | 53,589 | 1024 × 500 | 2 — RGB | Play feature graphic. Indigo gradient key art: amber "sun" badge with SD monogram, "Sunshine Daycare" title, "childcare, in your pocket" tagline, amber underline, EN/AR chips (login-surface KID-443 reference). 14 KB ≪ the 15 MB Play limit; all key art within the canvas bounds. |

## Verification proof (node/sharp equivalent of `identify`)

```
{"file":"play-icon-512.png","bytes":13731,"ihdrW":512,"ihdrH":512,"pngColorType":2}          // colorType 2 = RGB, no alpha
{"file":"adaptive-icon-background-432.png","bytes":3931,"ihdrW":432,"ihdrH":432,"pngColorType":2}
{"file":"adaptive-icon-foreground-432.png","bytes":4355,"ihdrW":432,"ihdrH":432,"pngColorType":6}
{"file":"feature-graphic-1024x500.png","bytes":53589,"ihdrW":1024,"ihdrH":500,"pngColorType":2}
```

Plus per-image `sharp` metadata (width/height/channels/hasAlpha) recorded in the
generation transcript on Paperclip issue KID-448; the 512 listing icon is
`channels: 3, hasAlpha: false`.

## Guardrails honored

- No Google Play Console (or App Store) account touched; no upload performed.
- No signing config, keystore, or AAB changes — none of these files are embedded
  in the app, so the release cert `8ce12814…01bd` and the published assetlinks
  remain untouched.
- No secrets committed; generation script and font live in the run scratch dir,
  only finished PNGs + this manifest are committed to the repo
  (`store-assets/` on branch `kid448-store-assets`) and attached to Paperclip
  issue KID-448.
- Play-rate check: the 512 icon, 432×432 adaptive pair, and 1024×500 feature
  graphic all conform to Play Console asset specs.
