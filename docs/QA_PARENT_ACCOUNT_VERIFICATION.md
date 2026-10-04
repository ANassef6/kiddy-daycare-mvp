QA validation plan for the parent-account enhancements in production.
Prepared before the deploy so the post-deploy pass is a checklist, not an
investigation. All criteria are observable from a browser or an HTTP response.

## Environment and access

- Production: https://kiddy-one.vercel.app
- Signed in as the **affected parent** (the account whose email is shared by both children).
- Browser: headless Chromium via the `agent-browser` skill.
- No arbitrary sleeps. Every wait is a `waitForSelector` / `waitForResponse` on the
  element or request named below.

## Preconditions the deploy owner must confirm

- **P1** Migration `0017_family_member_unique.sql` is applied on the live Postgres project.
- **P2** The backfill migration from KID-146 is applied on the live Postgres project.
- **P3** The deployed build corresponds to the commit that contains KID-141 through KID-144
  and the KID-146 backfill. The build id or commit sha is recorded on KID-147.
- **P4** A parent login exists for QA to use. If the board user must supply the password,
  the deploy owner states so on KID-147 before this pass starts.
- **P5** A **staff or admin** login for the QA fixture's centre exists for QA to use. Added
  after the KID-151 handoff. C1 can only be observed as a *transition* if something re-links
  the sibling during the pass, and the only writer that runs outside a migration is
  `autoLinkSiblingsForContact`, which fires on a staff contact save and is not reachable
  from a parent session. A parent credential alone cannot produce a non-vacuous C1, so the
  parent and staff logins are two separate requirements, not one.

N/A for QA: P1 to P3 are deploy evidence, checked by reading KID-147, not by re-testing here.

## Must-pass criteria

- **C1 (primary regression).** **Given** a parent account whose email is the contact email on
  two children, one of which was added before the KID-142 change, **when** the parent opens
  `/child`, **then** both children appear as separate cards, each showing the correct name
  and classroom.
  - Evidence: full-page screenshot of `/child` showing both children; DOM count of child
    cards equal to the number of children sharing the email.
- **C2 (no duplicates).** **Given** the same parent, **when** `/child` has loaded, **then**
  each child name appears exactly once.
  - Evidence: the name list captured from the DOM, with per-name counts all equal to 1.
- **C3 (backward compatibility).** **Given** the backfill has run more than once, **when**
  `/child` is reloaded in a fresh session, **then** the child list is unchanged.
  - Evidence: second screenshot identical to the first, same child count.
- **C4 (activated label).** **Given** a parent contact whose login is activated, **when** an
  admin opens that child in `/portal/children/<id>`, **then** the contact shows an activated
  state and no "Resend invite" affordance.
- **C5 (pending label).** **Given** a parent contact that has never activated, **when** an
  admin opens the same page, **then** "Resend invite" is still offered.
  - C4 and C5 together prove the label is state-driven and was not hard-coded to one branch.
- **C6 (recipient scoping).** **Given** a signed-in parent, **when** the parent opens
  `/child/messages` and opens the compose control, **then** the recipient list contains only
  staff assigned to a classroom where the parent's children are enrolled.
- **C7 (server-side rejection).** **Given** the recipient id of an admin who is not assigned
  to the parent's children's classroom, **when** a direct send is posted, **then** the server
  rejects it and no message row is created for that recipient.
  - Evidence: the POST response, plus the message list before and after showing no new thread.
- **C8 (staff regression).** **Given** a signed-in admin and a signed-in classroom staff
  member, **when** each opens the staff child list and one child detail page, **then** both
  render normally with no error state.

## Secondary and edge criteria

- **C9 (empty state).** **Given** a parent with no linked children, **when** `/child` loads,
  **then** the empty state renders with its activation hint.
- **C10 (navigate away and back).** **Given** `/child` shows both children, **when** the
  parent opens one child, then returns to `/child`, **then** both children are still listed.
- **C11 (cross-institute isolation).** **Given** a child in a different center that shares the
  parent email string, **when** `/child` loads, **then** that child is not listed.
- **C12 (console clean).** **Given** the full pass, **when** the browser console is read at the
  end, **then** there are no uncaught errors and no failed same-origin requests on `/child`
  or `/child/messages`.
- **C13 (cross-tenant isolation — added after KID-152).** **Given** a parent account linked to a
  child at the QA centre, **when** a staff member at a second centre records a contact carrying
  that same parent email, **then** the parent account does not gain access to the second
  centre's child, and that child does not appear in the parent's list.
  - This is the production check for the runtime leak in KID-152. It needs a second institute,
    so it cannot be demonstrated against single-institute production. It is verified at the
    data layer by `tests/unit/kid149-backfill-isolation.test.ts`. Record here whether that
    test was green at the deployed commit, since production cannot show this case itself.

N/A for this change: performance envelope. The list is a small bounded set per account and
the change adds a migration, not a query on a hot path. Recording this rather than omitting it.

## Evidence to attach

For each criterion: the pass/fail result, and for every pass a screenshot, a DOM extract, or
a copied response. A criterion with no evidence is not a pass.

## Regression test added on this pass

A data-layer test reproduces the reported defect without a browser. It exists so the bug
cannot return silently between deploys:

- Arrange: two children in one institute, a contact with the same email on each, and a
  parent account linked to only the first child. No create or update event fires.
- Act: read the parent's visible children.
- Assert: both children are returned.

On the code as of `9754d71` this test fails with the second child missing, which is the
reported symptom. It is the exact regression this pass must show as fixed in production.

## Running C1 so it cannot pass vacuously

Added after KID-151 and KID-150. C1 says "both children appear"; it does not say *why* they
appear, and the reason is the whole test.

**The trap.** The KID-151 fixture was deliberately left in the pre-fix state — both contact
rows present, the sibling `family_member` link deleted — so the pass would exercise the real
reconcile path. Migration `0019` then applied on production at `2026-09-30T00:57:13Z`, and its
step 2 is the corrected sibling backfill. For that account the backfill matched, so it
re-created the link the fixture had deleted. The fixture reconciled with no human step. A C1
observation taken after that moment is a pass on data the migration wrote, which is the same
"green build, unapplied change" error this whole issue line exists to catch, in the other
direction.

**Two engines, two meanings of `ensureSchema()`.** On production the repair cannot re-run from
a page load: `ensurePgSchema()` skips every file already in `schema_migrations`
(`lib/db.ts`). The SQLite test mirror re-runs every migration body on every call
(`lib/sqlite-schema.ts`). So a reset fixture is **stable on production** and **unstable
locally**. Never reason about post-`0019` production behaviour through a local `ensureSchema()`.

**That is about a file already in the ledger. A file that is *not* in the ledger goes the other
way** — `app/child/layout.tsx` and `app/portal/layout.tsx` each `await ensureSchema()`, so a newly
deployed migration applies itself on the first authenticated request, with no deploy step and no
staff action. Do not read "page loads cannot re-run migrations" as "a deploy is inert." See
"How database migrations are applied" in `docs/CONTACT_AND_ACCOUNTS.md` for the full runner
properties, and note that its `try/catch` call sites mean a migration that throws still renders a
normal page.

**Run order.** Each step is a checkpoint; record the child count at every one, because the
value of the whole pass is the sequence, not the final frame.

1. **Reset.** `DELETE FROM family_member WHERE account_id = '<qa account>' AND child_id = '<sibling child>'`
   (single row). Record the affected `family_member.id` before deleting it.
2. **A0 — precondition, parent view.** Parent signs in, `/child` loads. Record the child count:
   it **must be 1**. If it is 2, the reset did not hold or something re-linked it, and C1 is
   void — stop and say so rather than continuing.
3. **A1 — the page load must not self-heal.** Reload `/child` in the same session, then a
   fresh session. Still **1**. This is the negative control for the whole pass: it proves the
   production ledger is doing its job and that nothing about visiting the page grants the
   sibling. Without A1, a later "2" is indistinguishable from a migration side effect.
4. **A2 — trigger the runtime path.** As **staff** (P5), open the sibling child and re-save its
   contact with the parent address (a no-op edit that fires `autoLinkSiblingsForContact`). Do
   not use `addContact` on a new child here — that would add a card and make C1's card count
   ambiguous.
5. **A3 — observe.** Parent reloads `/child`. Record: **2** cards, each name exactly once
   (C2), correct name and classroom on each.
   - **Record the relationship role on each card too**, not only the count. A count of 2 with
     one link downgraded to `pickup` or `no_access` satisfies C1 and C2 as written. See
     [KID-160](/KID/issues/KID-160): `linkSiblingsByParentEmail` writes the role of whichever
     same-address contact the engine returns last, with no precedence, so a second contact
     with a weaker relationship can overwrite a `parent` role. Until that is fixed, a green
     C1/C2 here does not prove the parent holds `parent` access to both children.
6. **A4 — no drift.** Reload again in a fresh session. Still 2, identical list (C3).
7. **A5 — no widening.** Record `crossInstituteFamilyMemberRows()` for the account (empty) and
   `SELECT count(DISTINCT institute_id) FROM institute`. Use the shipped function, never a
   hand-written cross-institute count: on a single-institute database a hand-written count
   reads 0 for a reason that would also hide a live leak, so it carries no information.

**What makes C1 a pass.** The sequence `1 → 1 → 1 → 2`, where the only action between the third
`1` and the `2` is a staff contact save. A bare `2` at any point, with no recorded `1` before
it, is a **vacuous pass** and must be reported as unverified — not as pass.

**If the reset is declined or a second institute is not permitted.** Fall back to the additive
route: staff add a *third* child at the same centre with the parent address on its contact.
That needs no destructive write, and the transition `2 → 3` is just as observable. Never
re-seed the expected result.

**Data-layer pin.** `tests/unit/kid148-fixture-reconcile.test.ts` holds the same contract with
no browser: the reset state is observable, the repair body re-asserts a deleted link, the staff
contact path is what restores it, a second save does not duplicate, blank and null addresses
grant nothing, and the local mirror's re-run behaviour is recorded as the harness asymmetry it
is. It is mutation-checked — a no-op reset fails five of its six cases and an over-tightened
tenant gate fails the three runtime cases — so it cannot pass by being blind.

## Identifying the deployed commit (added after the 2026-10-03 KID-172 pass)

P3 says the deployed build must correspond to a commit. On this project there is **no build id or
commit sha on any page**, so "check the build id" is not executable as written. It was resolved by
finding a string that only the candidate commit's own code can render.

**Two markers that look valid and are not. Do not use either.**

- **Chunk hashes.** Measured on 2026-10-03: production served
  `app/login/page-5f83c66d7f3b0a23.js`; the local pre-`2fd0129` `.next` held
  `page-88c0fd7120ebf3b4.js`; a fresh local `next build` of `2fd0129` produced
  `page-2f3b2f9cb5a68639.js`. Three builds, three hashes. Vercel inlines per-build server-action
  ids into the client chunk graph, so the hash moves even when the source does not. **A chunk
  hash is not deploy evidence here.**
- **`No login yet`.** Present at `13f3ae8:app/portal/staff/page.tsx:138`, which predates
  `2fd0129`. It is pre-existing copy, not new code, so its presence proves nothing about the
  deploy.

**A marker that works.** `2fd0129` renders a **Portal login** card on `/portal/staff/<id>` when
`!hasLogin`, and `hasLogin` is `SELECT ... FROM account WHERE staff_id = ?`
(`app/portal/staff/[id]/page.tsx:49,57,162`). No earlier commit can render that heading, and it
reads the `account -> staff` link directly rather than through a proxy.

**Check every row, not one.** A marker seen on a single record proves nothing if it is a
constant. Observed 2026-10-03 across all four staff records: card **present** on 2/2 records whose
list row reads `No login yet`, **absent** on 2/2 records that show an email. A marker that is
present everywhere is as useless as one that is present nowhere.

## Reading the portal UI for the D2 repair

The family contacts panel and the staff profile are both reachable only by clicking. Two traps,
both of which make a pass silently vacuous:

- **The contacts panel is behind a client-side tab.** `ChildProfileTabs` renders the active panel
  in a plain `div` — there is **no `role="tabpanel"`** — so an `innerText` of the page, or a
  locator for `[role="tabpanel"]`, reads the default tab and reports zero contacts. Click each
  tab, then read the tablist's following sibling.
- **Reachability is per child, not per centre.** `classroomStaffForParent` needs
  `child.room_id = staff_room.room_id`, so a staff member who *is* reachable may still not serve
  the children under test. On 2026-10-03 `bluestaff` had both a login and a classroom, and the QA
  parent still saw no recipient, because that classroom was `manual test` while Kian and Lina were
  in `Toddlers`. Always record each child's room next to each staff member's rooms, or "this
  staff member is fine" will be the wrong conclusion.
