# KID-683 evidence — per-daycare branding no longer leaks onto the public platform

Report (via KID-215, 2026-11-07): Sunshine Daycare's uploaded logo and brand
image appeared on the public platform `kiddyapp.net` and its global auth pages.
KID-493 mounted `components/BrandBanner` in the root layout, but
`lib/theme.ts getBranding()` resolved an institute without a session/daycare
scope on generic hosts: the anonymous path fell back to `getFirstInstitute()`
(whichever daycare was created first — Sunshine, row 1). That comment even
called it the "legacy" behavior, and `tests/unit/kid212-subdomain.test.ts`
pinned the first-institute fallback for the apex ("anonymous branding on the
apex keeps the legacy first-institute fallback") — the pin described the leak.

## Fix

Commit `7509e37` — **PR #48** (merged into master, merge commit `5b1a70f`).
`getBranding()` now resolves:

- **apex/legacy hosts, anonymous** (kiddyapp.net landing pages, `/login`,
  `/register`, password reset): platform brand only — never
  `getFirstInstitute()`. The banner renders nothing; `AuthBrand` stays "Kiddy";
- **daycare subdomains, anonymous or signed-in**: THAT daycare's brand (host
  rule, unchanged from KID-199.3r/256);
- **signed-in on generic hosts**: the session's own daycare only — a Maple
  account never sees Sunshine's brand and there is no first-institute
  fallback (two-tenant test);
- **platform operator**: generic platform brand (unchanged, KID-199.4r).

Upload → `updateInstitute` → `clearBrandingCache()` →
`revalidatePath("/", "layout")` flow untouched (KID-493 behavior preserved).

## Tests

`tests/unit/kid683-brand-scope.test.ts` (new, 8 tests) pins, against concrete
tenant asset URLs (repo convention: absence of data, not kind labels):

1. anonymous apex resolves name "Kiddy", `logoUrl`/`brandImageUrl` null, the
   Sunshine primary color NOT returned (first tenant had every asset seeded);
2. the `/login` header brand (`brandNameForTitle`) stays "Kiddy" even with two
   fully-branded tenants;
3. two-daycare fixture: Sunshine's subdomain shows Sunshine, Maple's shows
   Maple, the apex shows neither, unknown subdomains show nothing;
4. the apex + Sunshine session resolves Sunshine WITH its uploaded assets;
5. the apex + Maple session resolves Maple — never the first-created tenant
   (the multi-daycare safety pin);
6. the platform operator on the apex stays generic;
7. the cache-invalidation contract (`clearBrandingCache`) is unchanged.

`tests/unit/kid212-subdomain.test.ts` now pins the platform-brand rule for the
anonymous apex instead of the first-institute fallback, plus the signed-in
apex rule. Full unit battery: **86 files / 923 tests green**; `tsc --noEmit`
and `npm run lint` exit 0.

## Production verification (before / after deploy)

| Check | Before (`9bf1c04` build) | After (`5b1a70f`, deployment 7625902988, state success) |
| --- | --- | --- |
| `https://kiddyapp.net/` | rendered Sunshine's brand image in the banner: `https://sfetmfmtoubtdyyeyudd.supabase.co/storage/v1/object/public/kiddy-public/branding/mtnfwlhn-jokgnsiw/brandImage-1794070386146.jpg` alt "Sunshine Daycare brand image" — see `prod-home-before-sunshine-leak.html` | **0** occurrences of `Sunshine` / `brandImage-`; no banner img — `prod-home-after-fix.html` |
| `https://kiddyapp.net/login` | (same root-layout banner source) | **0** occurrences of `Sunshine` / `brandImage-`; no banner img — `prod-login-after-fix.html` |
| `https://sunshine.kiddyapp.net/login` | n/a | Sunshine brand intact on the DAYCARE's own surface: the uploaded brand image still renders (KID-493 behavior preserved) — `prod-sunshine-subdomain-login-after-fix.html` |

- Deployment: GitHub deployment 7625902988 (environment Production, created
  2026-11-07T19:24:46Z for commit `5b1a70f`), status **success**; commit head
  status success.
- `https://kiddyapp.net/` and `/login` HTTP 200 post-deploy.
