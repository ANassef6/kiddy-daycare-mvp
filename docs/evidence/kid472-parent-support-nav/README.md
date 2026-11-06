# KID-478 — KID-472 items 6 + 8: parent support-request UI removed, Supplies/Rooms moved under Children

Branch `kid472-remove-support-ui-move-nav` (from `origin/master` at the KID-477 audit-trail merge).

## What changed

Item 6 — parent-facing manual support-request UI removed:

- `app/child/support/page.tsx`: the "Send request" form card and the "My requests" list card below the Chatwoot help center are gone, together with the `createSupportTicketAction` / `ticketsForAccount` / `cap` imports. The page now renders the page title + `HelpCenter` only; the Chatwoot knowledge base (KID-428 search + EN/AR toggle, role-filtered) and the live-chat bubble (`app/layout.tsx` ChatwootWidget) remain the whole parent support surface.
- `app/child/support/[id]/page.tsx`: the "Still stuck?" article exit no longer points at the deleted `#support-form` anchor — it returns to `/child/support`.
- `components/HelpCenter.tsx`: the now-dead `requestFormHref` prop and its two "Send a support request" exit buttons (no-result card + unavailable card) are removed from the shared component; the staff surface is unaffected.
- `lib/i18n.ts`: parent-ticket-only `help.*` keys dropped from BOTH dictionaries (`sendRequest`, `myRequests`, `noRequests`, `formSubject`, `formSubjectPlaceholder`, `formMessage`, `requestSent`, `requestIntro`); `noResultsHint` / `unavailableHint` (EN+AR) now say to chat from the support bubble instead of "send a request". Key parity EN↔AR preserved.
- Kept deliberately untouched: `lib/actions.ts` `createSupportTicketAction`, the staff support inbox (`/portal/support-inbox`) and the `support_ticket` table — historical/staff use only.

Item 8 — portal sidebar regroup:

- `components/PortalSidebar.tsx`: Supplies (`/portal/supplies`) and Rooms (`/portal/rooms`) leave the admin-only Tools group and join the Children group, still gated behind `isAdminRole` (plain staff/carer/parent never see them). Tools keeps Report center, Smart list, Smart form, Surveys, Performance, Finance plus the two owner-only tabs (Account billing, Enhancements requests) — gating contracts of KID-105 #14 / KID-246 / KID-264 unchanged. Active highlighting and the accordion rely on the same `matches`/`activeIn` logic over the new href placement (prefix matching keeps `/portal/rooms`, `/portal/supplies` highlighting identical), and the sidebar is the single nav surface (responsive CSS — no separate mobile nav tree).

## Tests

- `tests/unit/kid472-parent-support-nav.test.tsx` (new, 13 tests):
  - Item 6 pins — /child/support renders the help center island; no textarea/input ticket form, no "My requests"/"Send a support request"/`#support-form` markers in the rendered HTML; the page module no longer imports the parent ticket action or ticket list; the staff action stays in `lib/actions.ts`; the eight ticket keys are absent from both dictionaries while the new chat-bubble copy is present in EN and AR; EN↔AR help-dictionary key parity; the Chatwoot widget is still mounted on the parent app shell.
  - Item 8 pins — owner/admin see Supplies+Rooms under the Children group and not under Tools; staff/carer/parent see neither item anywhere and have no Tools group; labels resolve from the active locale dictionary in EN and AR (AR word pinned); both moved routes still resolve to real page modules (dead-link gate).
- `tests/unit/kid428-chatwoot-help-center.test.tsx`: the list-chrome expectations drop the removed "Send a support request"/"My requests" strings; the empty-result-card test now pins the ABSENCE of the request-form anchor plus the new hint copy.

## Gates

- `npm test` (`vitest run`): 71 files / 731 tests, all green (includes kid472 suite, kid428 x2, kid246, kid264, kid221, kid472-audit-trail 14/14 — audit instrumentation of the still-existing staff ticket action untouched).
- `npx tsc --noEmit`: clean.
- `npm run lint`: no errors (pre-existing `<img>` warnings only).
- `npm run build`: success; `/portal/supplies`, `/portal/rooms`, `/portal/support-inbox` all present in the route manifest.

## Production/PR record

- PR #18 (`kid472-remove-support-ui-move-nav` → `master`), checks green (Vercel pass, deployment `https://vercel.com/kiddy2/kiddy/B8seMoBqCHjEC4x5YzogitHX34zY`), merged at GitHub commit `83951ba` ("Merge pull request #18 from ANassef6/kid472-remove-support-ui-move-nav", master head `origin/master`).
- Production deployment of the merge commit: GitHub deployment id 7603625876 (environment `Production`, sha `83951ba`), status `success` at 2026-11-06T15:19:12Z, target `https://kiddy-dbkvm60ll-kiddy2.vercel.app` (master auto-deploys on Vercel).
