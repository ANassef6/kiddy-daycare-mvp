# KID-493 — KID-489 items 3+4: stacked brand lockup + brand-image banner on all pages

Branch: `kid489-branding` — PR to `master`.

## What changed

1. **Stacked brand lockup (item 3)** — `.site-brand` is now a column flexbox: the
   logo sits above the complete daycare name on every surface:
   - Portal sidebar (`components/PortalSidebar.tsx`)
   - Parent header (`app/child/layout.tsx`)
   - Auth pages login/register/forgot-password (`components/AuthBrand.tsx`)
   - Settings preview card (`app/portal/settings/page.tsx`)
   - `.shell-side a { display:block }` used to out-specify `.site-brand`
     (class+type beats class) and collapse the sidebar lockup back to a block
     row — a higher-specificity `.shell-side a.site-brand` rule re-declares the
     stack. Under RTL the column layout is direction-agnostic (centered, no
     mirroring needed).
   - Long names **wrap** (no ellipsis): the parent-header mobile rule dropped
     `text-overflow: ellipsis`/`nowrap` for `overflow-wrap: anywhere` while
     keeping `flex: 1 1 0` so the pinned sign-out action stays in the row, and
     the sidebar rule wraps within the 220px column.
2. **Brand-image banner (item 4)** — `components/BrandBanner.tsx` renders
   `institute.brand_image_url` as a responsive banner (`width:100%; height:auto;
   max-height:220px; object-fit:cover`) at the top of every page: the root
   layout (`app/layout.tsx`) mounts it right after the skip link and before
   `{children}`, so portal, parent, auth and marketing pages all carry it from
   the branding the layout already resolves. `src=null` renders nothing (no
   wrapper, no gap, no layout shift). Alt text names the daycare
   ("${name} brand image" / AR "صورة العلامة التجارية لـ…").
3. **Honest upload feedback** — `uploadBrandingImageAction` no longer silently
   keeps the previous branding: Supabase Storage unconfigured →
   `?error=upload-storage`; upload failure → `?error=upload-failed`, both
   rendered as a localized `role="alert"` banner on /portal/settings (EN + AR
   strings `settings.uploadStorageError` / `settings.uploadFailedError`). A
   successful upload (and `saveBrandingAction`) calls `clearBrandingCache()` +
   `revalidatePath("/", "layout")` so the banner/logo appears on the next
   navigation instead of after the 30s TTL window (signed-in branding was never
   TTL-cached; this fixes the anonymous login/banner path + client caches).

## Screenshots (local dev: SQLite + seeded demo daycare, brand image set directly on the institute row as a test-image data URL; captured with the Skyvern browser at 1920px)

| File | Shows |
| --- | --- |
| `login-final.png` | /login EN — brand banner at top, stacked lockup (logo above name) |
| `login-arabic.png` | /login AR (RTL) — banner + stacked lockup direction-agnostic |
| `parent-home.png` | /child parent home — banner + stacked header brand |
| `portal-dashboard.png` | /portal/dashboard — banner + stacked sidebar brand |
| `settings-upload-error.png` | /portal/settings — banner + stacked preview card + Logo&brand image card |

Mobile (<720px) is verified by the suite's CSS contract
(`.child-header .site-brand .brand` wraps instead of ellipsis; single-column
shell) rather than a Skyvern capture — Skyvern has no viewport parameter.

## Honest-upload proof (does not depend on the screenshot)

Through the real UI (admin logged in, Brand-image Upload clicked with a file):
`uploadBrandingImageAction` hit the no-storage branch and redirected — dev log:

```
GET /portal/settings?error=upload-storage 307 in 1373ms
GET /portal/settings?error=upload-storage 200 in 71ms
```

and the server-rendered banner verified via exact HTML:

```html
<div role="alert" class="banner-error" … dir="auto"><bdi>Image storage (Supabase Storage) is not configured, so the image could not be uploaded. Nothing was saved.</bdi></div>
```

## Local verification

- `npx vitest run tests/unit/kid489-branding.test.tsx` — 13/13 (component/markup
  contracts, styled stacking + banner wiring, honest-error redirects, EN/AR strings).
- `npx tsc --noEmit` — clean (2 concentrations in the untracked
  `components/PickupTimeForm.tsx` are a concurrent run's in-flight file, not in
  this tree).
- `npm run lint` — exit 0 (6 pre-existing `<img>` warnings in untouched files).
- full `npm test` — see run book below (executed while a sibling run's suite
  hogged the box; see final summary).
