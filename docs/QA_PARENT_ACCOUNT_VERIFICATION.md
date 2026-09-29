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
