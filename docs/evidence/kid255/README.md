# KID-255 — Parent header: sign-out trimmed off-screen at top right on Android

Run stamp: 2026-10-28, local dev server (`next dev`, parent session
`parent@example.test` / staff cross-check), head of the KID-255 branch.

## Defect

The parent portal header (`app/child/layout.tsx`) put the brand link plus
nine nav links, the settings link, and the sign-out button (form button with
`formAction="/api/logout"`) into one `.nav` flex row. At phone widths the row
wrapped into 3–4 cramped link rows and the sign-out button ended up pushed
against/past the right viewport edge (on real Android device metrics /
font scaling it was trimmed and untappable). Parent-reported in KID-253.

## Fix (deliberate overflow behavior: collapse into a hamburger)

- `components/ChildNavMenu.tsx` (new): one component owns the header nav.
  - **≤720px:** hamburger button opens a right-anchored dropdown panel with
    all nine links + Settings; the **sign-out button stays pinned as the last
    header-row item** — fully visible and tappable at 320–430px with no
    interaction needed. Brand truncates (ellipsis) instead of pushing the
    button off-screen; `flex-basis: 0` keeps the header on a single row.
  - **>720px:** `display: contents` on the inline nav dissolves it into the
    same flex row as the sign-out button — pixel-identical flow to the old
    single `.nav` row (verified below).
  - Close-on-navigate / outside-pointerdown / Escape mirrors the
    PortalAccountMenu contract (KID-199.2).
- `app/globals.css`: `.child-nav*` styles + 720px breakpoint; logical
  properties (`inset-inline-end`) so the panel stays inside the viewport in
  RTL too.
- `lib/i18n.ts`: `nav.menu` ("Menu" / "القائمة") for the hamburger label;
  expand/collapse aria-label reuses `nav.expand`/`nav.collapse`.
- Staff portal checked, **not affected**: sign-out lives in the top-right
  account dropdown (`PortalAccountMenu`), right-aligned inside the container
  padding; measured fully on-screen at 320/360px (see `before-staff-320`
  verification below). `/welcome` (login-adjacent, sign-out link) is plain
  in-flow content inside a 520px container — nothing to trim.

## Measured geometry (headless Chromium, `button[formaction="/api/logout"]`)

| Viewport | Before | After |
|---|---|---|
| 320px | wrapped to 3rd link row, `top≈208`, flush against right edge / trimmed on device | `right=304`, single header row, on-screen, `aria-expanded` burger |
| 360px | wrapped, `top≈168` | on-screen, single row |
| 390px | wrapped, `top≈168` | on-screen, single row |
| 430px | wrapped, `top≈128` | on-screen, single row |
| 768px | `left=268 right=366 top=88 w=98` | **identical** (`268/366/88/98`) |
| 1280px | `left=524 right=622 top=88 w=98` | **identical** (`524/622/88/98`) |

`scrollWidth == clientWidth` at every width (no horizontal overflow), before
and after. Menu-open panel at 320px spans x=24..304 (fully in viewport);
Arabic RTL at 320px: sign-out on-screen, panel x=16..296.

## Screenshots (this directory)

- `before-320.png` / `before-390.png` — old header: 4 wrapped link rows,
  sign-out pushed to the edge.
- `after-320.png` / `after-390.png` — new header: brand + hamburger + pinned
  Sign out.
- `after-menu-320.png` / `after-menu-390.png` — hamburger open: all links +
  Settings in the dropdown, sign-out still visible.
- `after-ar-320.png` / `after-ar-menu-320.png` — Arabic RTL mirror.
- `after-desktop-1280.png` — desktop unchanged.

## Gates

- `npm run test`: full suite green, including new
  `tests/unit/kid255-child-nav.test.tsx` (markup contract: closed by default,
  all items + settings in inline nav, sign-out pinned outside the nav flow,
  pickup-role 1-item slice, EN/AR labels).
- Real-browser interaction (dev server): panel opens, closes on navigation /
  outside click / Escape; burger `aria-expanded` toggles.
- Desktop: geometry byte-identical to the old rendering at 768/1280px.
