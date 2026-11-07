# KID-534 — KID-482 D-2: intermittent HTTP 500 on parent `/child/messages`

Date: 2026-11-07 · Branch: `kid472-messages-500` · Base: `origin/master` `99822d3`

KID-482 QA (merged PR #32, commit `99822d3`) recorded D-2: the parent messages
page rendered Next.js's "Application error … Digest: 3930614149"
server-component exception page on 2 of 4 real-browser loads (04:22:51Z and
04:27:55Z on 2026-11-07), while 16+ sequential curl loads and a 10-request
parallel burst all returned HTTP 200.

## 1. Root-cause analysis

### What digest `3930614149` covered

The page (`app/child/messages/page.tsx` before this fix) awaited ~10 store/DB
calls directly inside the server component, **all unguarded**:

| # | Read (before fix) |
|---|---|
| 1 | `requireFamilyPage("/child/messages")` → `runWithdrawalSweep`, `isAccountAccessWithdrawn`, tenancy check (guarded by try/catch only for the sweep) |
| 2 | `i18nForAccount(session.accountId)` → `getAccount` |
| 3 | `firstInstituteId()` |
| 4 | `parentMessageRecipients(session.accountId)` → `classroomStaffForParent` |
| 5 | `getAccount(session.accountId)` |
| 6 | `threadsForAccountScoped(session.accountId)` → `threadsForAccount` + `classroomStaffForParent` + per-thread `threadParticipantIds` |
| 7 | when `?thread=`: `threadForViewer`, `threadMessages`, `threadParticipantIds`, participant-name `queryAll`, write `markThreadRead` |
| 8 | when no thread: `conversation(me.id, center.id)` + write `markRead` |

`response.json-or-nothing`: none of those reads caught anything. A **transient
rejection in any single one of them propagated out of the server component**,
and Next served the unhandled-exception page (the captured digest `3930614149`)
at HTTP 500 with no retry affordance.

### Why it was intermittent (mechanism)

The app in production mode is `KIDDY_DATABASE_URL` = shared Supabase Postgres
via the Supavisor pooler; `lib/db.ts` opens a `pg` Pool with `max: 5` and a
10 s connect timeout (`lib/db.ts:23-37`). One `/child/messages` render issues
8–12 sequential queries, so the failure class requiring **two things to
coincide** is narrow:

1. a moment when the pooler/instance is under connection pressure (QA noted
   "concurrent agent traffic was hitting the tenant" at both failure
   timestamps), producing a transient error (pool timeout, refused/temporarily
   unavailable pooler connection, statement timeout) — and
2. that error landing under one of the unguarded reads above.

That matches the QA observation exactly: low-concurrency curl always 200;
the rare race under burst/external load → one rejected read → dead page.
`recordToolUsage` was already self-guarding (`lib/tool-usage.ts` catches and
logs), so it was not part of the failure class.

### Vercel runtime log correlation — not available in this sandbox

The task allows "reproduce **or** correlate with Vercel runtime logs, or bound
the failure class with an explicit residual note". This sandbox has no Vercel
log-access credentials (only GitHub tokens; querying the Vercel runtime logs
API for digest `3930614149` requires a team-scoped `VERCEL_TOKEN` we do not
have and did not guess). **Residual note:** the exact failing stack/frame
behind digest `3930614149` is therefore unconfirmed; what is pinned is the
failure *class* — "any transient rejection inside one of the page's direct
reads escapes the render and becomes an unhandled 500". That is what the fix
bounds and the regression tests pin below.

## 2. Fix

Three layers, deliberately without touching auth/tenant/permission behavior:

| File | Change |
|---|---|
| `app/child/messages/page.tsx` | Every direct read is wrapped in `readPart()` (`ok/value` result): a failure is **logged loudly with the read name + stack** (never a silent catch), and only the part of the page that depends on that read degrades. The page can no longer throw out of its data layer. Best-effort writes (`markThreadRead`, `markRead`, `recordToolUsage`) go through `softWrite()` — skipped + logged on failure. Honest degradation rules: a failed recipient read renders **neither** a composer **nor** the misleading "no staff available" copy; a failed i18n read falls back to the English dictionary; a failed thread/message read bounds the affected card. If any read failed, the page renders a recoverable `messages-load-error` panel instead of crashing. |
| `components/MessagesLoadError.tsx` (new) | Pure server-rendered recovery panel: title + hint + **"Try again" anchor to the same URL** — works without JavaScript, so a render that degraded still offers recovery. |
| `app/child/messages/error.tsx` (new) | Segment-level error boundary for `/child/messages`, same pattern as `app/register/error.tsx` (KID-121): a client boundary with `reset()` retry. Catches whatever can still throw *in front of* the page (the session/tenant gate reads in `requireFamilyPage` run before the page's guarded reads), so no failure class on this route reaches an unhandled 500. |
| `lib/i18n.ts` | New localized keys `messages.loadFailedTitle`, `messages.loadFailedHint`, `messages.tryAgain` (EN + AR). |

Nothing in the happy path changed: same reads, same render order, same copy.

## 3. Regression tests (`tests/unit/kid472-messages-500.test.tsx`)

The page component is driven as a real async server component against the
seeded local data layer (`seedFixture`), with passthrough module mocks so each
test fails exactly one read (the same shape the production runtime produced):

1. Happy path: composer renders, no recovery state.
2. `threadsForAccountScoped` rejects → page renders `messages-load-error` +
   retry anchor instead of throwing (pre-fix: this escaped as the 500).
3. `classroomStaffForParent` rejects → recovery state; **no composer and no
   "no staff" copy** (neither claim would be honest).
4. `conversation` rejects → bounded direct surface + recovery state.
5. `threadMessages` rejects inside an open thread → bounded inline error in
   the thread card + recovery state.
6. `threadForViewer` rejects → recoverable state, no re-throw.
7. `getAccount` rejects (shared read behind locale resolution) → English
   fallback + recovery state.
8. `error.tsx` boundary renders its `reset()` affordance for a
   digest-carrying exception like the production one.

## 4. Soak check (production build)

Local production build (`next build` → `next start`, seeded SQLite engine — the
QA-recorded pattern from KID-482 item 9), signed-in parent session (real
`createSessionToken` cookie for the seeded parent `parent@example.test` account;
credentials never written anywhere), build from `origin/master` `99822d3` **+**
this branch:

| Phase | Request shape | Result |
|---|---|---|
| Sequential | 60 × `GET /child/messages` (direct surface, 2 seeded DMs rendered) | **60 × HTTP 200** |
| Sequential | 60 × `GET /child/messages?thread=<id>` (thread surface: message list + participants + mark-read write) | **60 × HTTP 200** |
| Parallel burst | 6 rounds × 10 concurrent (alternating direct/thread) | **60 × HTTP 200** |

**Total: 180 loads, 180 × 200, 0 × 5xx, 0 errors/exceptions in the server log.**
The server-rendered page on a signed-in parent session issues every read the
QA-failing page used, so the soak exercises the same render path that
returning 200 pre-fix — and the failure class is now additionally bounded by
the guards (§2) + pinned by the regression tests (§3).

Keep the failure-class note explicit: the soak proves the fixed route is
stable under the deterministic local engine; the intermittent-production
trigger (shared pooler pressure under concurrent load) is bounded by the
guarded reads + the segment error boundary, not by the soak itself.

## 5. Verification battery

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — clean, exit 0 |
| `npm run lint` | **PASS** — exit 0 (pre-existing `no-img-element` warnings only) |
| `npm run build` | **PASS** — "Compiled successfully", 66/66 static pages |
| `npm test` (vitest, full suite in isolated worktree) | **PASS — 844/844 tests, 78 files, 0 failures** |
| `npm run db:verify-migrations` | **PASS** — all migration checks passed (no migration added by this change) |

## 6. Parent → staff → parent round trip

Pinned as a regression test in the same file ("parent → staff → parent round
trip still passes"), exercising the real production actions — the same code
path the deployed composer forms close over — on the real data layer:

1. **Parent sends** inside a thread via `sendParentMessageAction` (threadId +
   hidden recipient — the exact payload the `/child/messages` thread composer
   posts) → redirect `/child/messages?thread=<id>`.
2. **Staff replies** via the portal thread-reply action (`replyThreadAction`)
   as the classroom staff account → redirect `/portal/messages?thread=<id>`.
3. **Parent re-reads** the thread: `threadsForAccountScoped` lists it, and a
   fresh server render of the page shows both legs' bodies, no recovery state.
4. Plus a direct-DM leg: `sendParentMessageAction` (1:1) → staff
   `sendMessageAction` reply → parent re-read of the direct surface renders
   both messages.

## 7. PR merge + production deployment

| Check | Result |
|---|---|
| PR | [#35](https://github.com/ANassef6/kiddy-daycare-mvp/pull/35) `kid472-messages-500` → master, **merged** |
| Merge commit on master | `a1596cf` ("Merge pull request #35 from ANassef6/kid472-messages-500") |
| GitHub commit status on `a1596cf` | `Vercel — success — Deployment has completed` → deployment [`dpl_76Wb9izc…`](https://vercel.com/kiddy2/kiddy/76Wb9izcaxc8mFuurLoX8df8qRYP) |
| Pre-checks on the PR branch | `Vercel` pass (Deployment completed, `dpl_2dKzrYhm…`), `Vercel Preview Comments` pass, `Supabase Preview` skipping (same pre-existing ledger rename note as PRs #30–#32, owner action record in KID-492 evidence) |

### Production soak re-run (live tenant, signed-in parent, deployed fixed build)

Target `https://sunshine.kiddyapp.net/child/messages`, parent session obtained
through the normal REST login endpoint (`POST /api/mobile/login` — legitimate
product surface; the parent account is the seeded demo parent Grace Nguyen;
the credential lives only inside the one invocation, never in text/commits):

| Phase | Request shape | Result |
|---|---|---|
| Sequential | 60 × `GET /child/messages` | **60 × HTTP 200** |
| Sequential | 60 × `GET /child/messages?thread=mv84upyq-862jfta1` | **60 × HTTP 200** |
| Parallel burst | 6 rounds × 10 concurrent (alternating direct/thread) | **60 × HTTP 200** |

**Total: 180 live production loads, 180 × HTTP 200, 0 × 5xx — no recurrence of
the digest error page.** The thread surface renders on the QA-observed tenant
(`Nassef` participants visible in the thread card), and the direct surface
still renders the live composer (`data-testid="messages-send"` present).

### Production round-trip note

The production write legs (parent send / staff reply) go through server
actions bound to client-component closures — not callable outside a browser —
so the round-trip regression is pinned at the real-action level in the
regression suite (§6.1–6.4: exact payload shapes the deployed forms post,
production action code, real data layer, fresh server renders re-read).
The parent GET re-read legs were additionally executed live in production
(§7 soak: direct + thread surfaces, 200 × 120).

No credentials, tokens, internal ids beyond route/thread renders, or secrets
appear in this file or the repo.
