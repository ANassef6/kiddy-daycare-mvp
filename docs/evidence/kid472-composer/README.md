# KID-475 — parent in-app message composer fixed + parent↔staff messaging verified end to end

Branch `kid472-composer-fix` (from `origin/master` @ `679426b`). Parent: KID-472 (board's 10-item
request, item 3). The board report: *"In-app messages. Is not functional, I can't send a message to
my child's staff, the textbox is not editable!"* — tested by the board member on their phone
(item 2 of the same list confirms the reporting device: "I've logged in as a parent on my phone").

## Reproduction and diagnosis

Two independent probes of the deployed shape (Chromium; parent locale EN **and** AR — the Sunshine
QA parent account is Arabic; viewports 320/360/390/430/1280; local seeded Sunshine fixture running
the production build):

1. **OBS-001 — the Chatwoot launcher bubble covers the composer's interactive corner.**
   The support widget (live on production: `chatwoot.kiddyapp.net` SDK referenced from every
   page) paints a fixed bottom-right launcher that floats over every scroll position. At 320x568
   it statically covers part of the message input: `document.elementFromPoint` at taps inside the
   input returned `BUTTON.woot-widget-bubble`, not the input (evidence:
   `screenshots/before-320-chatwoot-bubble-over-input.png`, where the RTL placeholder text is
   visually truncated behind the bubble). On any phone the parent who scrolls the composer into
   the lower part of the screen lands the row's interactive end (send button in EN, the message
   input's text start in RTL/AR) under the bubble — exactly the "textbox not editable" experience.

2. **OBS-002 — the composer wrapped into a cramped sliver at phone widths.**
   The `.row` composer (recipient select + input + send) wrapped its three flex items onto two
   lines above 320 and left the **message input 86px wide at 390px and 56px wide at 360px in
   Arabic** (`before-geometry-unchatwoot.json`) — a sliver next to a full-width recipient select
   that reads as a dead field even when focus works.

3. **What the composer was NOT:** not disabled, not an empty-recipient state (recipients resolve
   correctly — the no-staff state renders strongly in that case), not a server failure
   (`sendParentMessageAction` works and already surfaces refusals via `?error=…`; pinned by
   KID-169/KID-144 suites). Element hit maps and computed styles are in the two geometry JSONs;
   the input was always editable when tapped away from the bubble.

## The fix

| Area | Change |
| --- | --- |
| `components/ChatwootWidget.tsx` | Route-driven launcher visibility (`chatwootBubbleShouldHide` + `applyChatwootBubbleVisibility` / `scheduleChatwootBubbleVisibility`): the launcher bubble hides on `/child/messages` and `/portal/messages` (the two chat surfaces where it covers the composer) and restores everywhere else, using the SDK's `toggleBubbleVisibility`. The schedule retries (0/250/600/1200/2500ms) because the SDK builds its DOM asynchronously after `chatwootSDK.run`, which otherwise crashed the first toggle with a null classList. Env gating, identity wiring and all KID-306 behavior unchanged. |
| `components/MessageComposerForm.tsx` (new) | The parent composer (direct + thread reply, both on `/child/messages`) is now one client component that runs the same server action through a transition: pending flips the button to a localized "Sending…/جارٍ الإرسال…" label, disables it and sets `aria-busy` — no silent send on phones or desktop. Traces the repository's existing `AttendanceCheckIn` transition pattern; `react-dom@18.3` does not export `useFormStatus`. |
| `app/child/messages/page.tsx` | Uses `MessageComposerForm` for both composers; `data-testid="messages-input"` / `"messages-send"` for verification; the 260px inline `maxWidth` on the recipient select moved into CSS so the phone breakpoint can override it. |
| `app/globals.css` | `KID-475` bailout of the cramped wrap: at ≤720px the composer's select, input and button each take a full row with `min-height: 44px` (KID-369 tap-area guidance). Desktop is byte-identical to before. |
| `lib/i18n.ts` | `messages.sending` EN `Sending…` / AR `جارٍ الإرسال…`. |

No auth, tenant, billing, permission, `parentRecipientIds`, family-relationship or KID-169/KID-171
guard changed. The support widget stays fully available on every other page and inside the parent
support page itself.

## Post-fix verification (production build, real browser, this repo's runs)

Composer geometry after the fix (`geometry-after.json`): the input, recipient select and send
button all measure 288/328/358/398px wide at 320/360/390/430 with 44px heights; typing succeeded
in every cell; launcher hidden exactly on the chat routes (`screenshots/after-320-en-messages-stacked.png`,
`after-390ar-messages-no-bubble.png`) and restored on newsfeed/settings/dashboard overlays
(`after-390ar-newsfeed-bubble-restored.png`, `after-portal-messages-hidden.png`).

Parent↔staff messaging end to end (`e2e-flow.json`, all `true`), parent on a 390x844 mobile
viewport, staff on desktop:

| Step | Result |
| --- | --- |
| Parent sends a direct message from the composer | visible for parent + staff (`flow-1-parent-direct-sent.png`) |
| Staff reads it in `/portal/messages` and replies | staff reply visible for staff (`flow-2-staff-sees-direct.png`) |
| Parent sees the staff reply in the same conversation | pass |
| Parent opens a staff-created thread and replies in-thread | reply visible for parent (screenshot `flow-3-parent-thread-composer.png`) |
| Staff sees the parent's thread reply | pass (`flow-4-staff-thread-with-replies.png`) |
| Staff replies inside the thread | parent sees the staff thread reply | 
| Launcher bubble | hidden on both chat routes, restored elsewhere, no page errors recorded |

The `sendMessage`→notification bridge (KID-474) keeps working: the staff topbar bell lit from the
parent's sends during these flows.

## Checks

| Check | Result |
| --- | --- |
| `tests/unit/kid472-composer.test.tsx` (focused) | 10/10 |
| Neighbouring suites (kid306, kid169, kid207, kid171) | 39/39 |
| Full `npm test` | see the run log recorded in the PR comment (67 files, green) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (pre-existing `<img>` warnings only) |
| `next build` | clean (EXIT 0) |

## Production notes

- No migration, no env change (the Chatwoot widget env is already set on production; the fix is
  pure client bundle). Master merge auto-deploys on Vercel.
- The launcher hiding is path-based (`/child/messages`, `/portal/messages` + nested segments); new
  messaging surfaces only need their route added to `CHATWOOT_BUBBLE_HIDDEN_ROUTES`.
- The demo account lists and the Sunshine tenant use the same component tree, so the fix rides the
  standard deploy; the board's phone re-check is the QA gate.
