# KID-2459 — mobile responsiveness sweep

Status: **fixed and verified on staging. Awaiting founder QA before the
production cut.** Production is not touched until the founder signs off.

## Symptom

On a phone, app pages scrolled sideways. The worst case was staff Messages: the
desktop two-pane layout pushed the thread off-screen and clipped the composer's
Attach/Send controls. The founder asked for every app page to fit the viewport
width with no left/right swiping.

## Root causes

1. `.shell` is a grid. A grid item's default `min-width: auto` let one wide
   child (a data table, a long row) stretch the `1fr` track, so both
   `aside.shell-side` and `main.shell-main` grew past the viewport.
2. Bare `table.data` elements had no scroll container. Their min-content width
   widened the page instead of scrolling inside the card.
3. Upload forms in flex rows (`file` input + button) could not shrink.
4. Staff Messages kept `grid-template-columns: 280px 1fr` at every width.
5. Smart Lists had a second `280px 1fr` grid; the observation goals modal had
   `180px 1fr`.
6. A pickup-contact row with a long email could not wrap, so its badges pushed
   past the card.

## Fix

- `.shell-side` and `.shell-main` get `min-width: 0`; the `<=720px` shell track
  is `minmax(0, 1fr)`.
- At `<=720px` data tables use `display:block; width:100%; overflow-x:auto`, so
  they scroll inside the card.
- At `<=720px` `.row form` and `input[type=file]` can shrink/wrap; `.list-item`
  rows wrap and long text breaks.
- Staff Messages is single-pane below 720px: the conversation list is the entry
  point; an explicit thread, a 1:1 chat or `?compose=1` replaces it, with a
  localized back link. Desktop keeps the two panes.
- The Smart Lists builder and the observation goals grid stack on phones.
- The 12-column finance transactions table is wrapped in `.table-scroll` so it
  cannot push the desktop page either.
- EN + AR copy: `messages.backToConversations`.

No database, API, auth, or Cloudflare route/DNS changes. KID-2458 (public-site
blank hero) is untouched.

## Verification

### Scripted viewport audit

`docs/evidence/kid2459/mobile-audit.mjs` logs in, visits every route, and fails
when `document.documentElement.scrollWidth > clientWidth` (plus 1px rounding).
It also records the elements that stick out.

Every combination is **0 failures**:

| Surface | Widths | Languages | Routes | Report prefix |
| --- | --- | --- | --- | --- |
| Staff `/portal/*` | 360, 414 | EN, AR | 44 | `reports/audit-staff-*` |
| Parent `/child/*` | 360, 414 | EN, AR | 15 | `reports/audit-parent-*` |
| Desktop control | 1280 | EN | 44 + 15 | `reports/audit-*-1280-*` |

Routes checked (staff): dashboard, children, child profile, child billing,
child development, development list, messages (list, thread, composer),
newsfeed, attendance, calendar, rooms, room detail, staff list, staff profile,
staff hours, staff schedule, settings, account, account billing, finance,
events, learning (+ activities/curriculum/homework), report center, reports,
surveys, tags, forms, inquiries, enhancements, incidents, consents, drive,
support, support inbox, notifications, audit, performance, supplies.

Routes checked (parent): home, child profile, messages (list, thread),
newsfeed, notifications, settings, forms, events, learning, consents,
incidents, drive, support. `/child/support/[id]` was included in the script but
the founder fixture has no ticket row, so it is recorded as skipped.

On staging, the audit found two real-data cases the empty local seed did not:
the parent pickup-contact badge (+15px at 360px) and the finance table (+8px at
1280px). Both were fixed and re-run clean.

### Messages end-to-end

`docs/evidence/kid2459/messages-mobile-verify.mjs` — **25/25 pass on staging**:

- 360px and 414px, EN and AR (RTL).
- List visible by default; thread pane hidden.
- Open a thread: list hidden, thread visible, no page overflow.
- Back link, message input, Attach and Send are all inside the viewport
  (Attach/Send are 44px tall on phones).
- Back returns to the list.
- `?compose=1` shows the composer full width; Send is reachable.
- A 1:1 conversation row also replaces the list.
- 1280px control: both panes visible, `grid-template-columns: 280px 716px`.

Report: `reports/messages-mobile-staging.json` (local copy:
`reports/messages-mobile.json`).

### Screenshots

- `shots/staging/` — 360px staging screenshots of staff children, staff list,
  settings, tags, messages list; parent child profile, messages, settings; and
  the 1280px finance table.
- `shots/staging/messages/` — list → thread → composer at 360/414 in EN and AR,
  plus the desktop two-pane control.
- `shots/` — the same key pages from the local SQLite run for reference.

### Gates

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (pre-existing `<img>` warnings only) |
| Targeted unit tests | 121 passed (i18n, Arabic, RTL shell, child nav, messaging, KID-182/207/169/2455, KID-472 composer/500) |
| New guard | `tests/unit/kid2459-mobile-responsive.test.ts` (9 assertions) |
| PR checks | `audit`, `Test + build + wrangler dry-run`, Vercel staging all pass |

## Staging

| Item | Value |
| --- | --- |
| URL | https://kiddy-staging-orcin.vercel.app |
| Branch | `staging` |
| App commits | `2aed9a3` (main fix, PR #89), `414ba83` (follow-up, PR #90) |
| Merge commits | `59887ba`, `59343bd` |
| Credentials | `docs/STAGING.md` — founder fixtures only; never production |

The staging run created one test group thread (`mwsdk2b3-4p0knvzh`) via the
staff composer to exercise the thread pane. That is staging-only fixture data.

## Founder QA steps (staging)

1. On a phone (or DevTools device mode at 360–414px), open **Staff → Messages**.
   The conversation list fills the screen; no sideways swipe.
2. Tap a conversation: the thread replaces the list. Read the messages, type a
   reply, attach a file, send. Back returns to the list.
3. Tap ✎: the composer fills the screen; recipients, attachment and Send fit.
4. Visit Children, a child profile, Staff, Settings, Finance, Tags, Learning,
   Reports. None should scroll sideways.
5. Switch to **العربية**: the same single-pane behaviour and the back link are
   in Arabic; the page remains RTL.
6. On desktop (>=1024px), Messages still shows both panes; tables look as
   before.

After sign-off, the production cut is a `staging` → `master` merge coordinated
with Mika. Not done in this task.

## Re-run

```bash
# viewport audit (needs a Playwright browser; see the script header)
BASE_URL=http://127.0.0.1:4600 \
  STAFF_FILE=staging-owner.json PARENT_FILE=staging-parent.json \
  CHILD_ID=... STAFF_ID=... ROOM_ID=... THREAD_ID=... \
  ROLES=staff LANGS=en WIDTHS=360,414 \
  node docs/evidence/kid2459/mobile-audit.mjs

# messages flow
BASE_URL=https://kiddy-staging-orcin.vercel.app \
  CRED_FILE=staging-owner.json \
  node docs/evidence/kid2459/messages-mobile-verify.mjs
```
