# Kiddy — contact submissions & account access (Round 5)

_Last updated 2026-09-29 (KID-146, family-link backfill)._

## Where demo / inquiry submissions go

1. A visitor submits the **Book a demo** form on the public site (`/contact`).
2. `submitContactAction` (`lib/actions.ts`) writes one row to the **`contact_request`**
   table in the Supabase Postgres database.
3. The daycare owner sees every row in the portal at **`/portal/inquiries`**
   (Portal → Tools → Inquiries), newest first, with a one-click **Reply** mailto
   link. The portal dashboard also shows a "Demo & inquiry requests" card.

There is **no outbound notification email yet** (SMTP is not wired on the
Supabase project). The portal inbox is the notification path for now. To read the
raw rows directly:

```sql
SELECT created_at, name, email, phone, role, interest, message
FROM contact_request
ORDER BY created_at DESC;
```

The public form is daycare-only. The parent role option was removed so new rows
are `role = 'center'`.

## Sign-in, invites and password resets

- **Parents never self-register.** The daycare creates the invite
  (`inviteParentAction`, generating a code such as `SUNSHINE-1234`). The parent
  opens `/register`, enters the invite code, and sets their password. Without a
  valid, still-pending invite code the account cannot be created.
- **Parent invite email (KID-111).** Creating an invite attempts delivery via
  `sendParentInviteEmail` (`lib/invite-email.ts`) and records the outcome on
  the invite row (`email_sent_at` / `email_error` / `resend_count`, migration
  `0014_parent_invite_email.sql`). When `SUPABASE_SERVICE_ROLE_KEY` is set, a
  real GoTrue admin-invite email is sent; otherwise the invite stays `pending`
  and the portal shows the admin the activation link (`/register?code=…`) to
  forward manually. Duplicate pending codes are rejected. Pending invites can
  be re-sent with `resendParentInviteAction` (rate-limited and audit-logged via
  the shared `activation_resend_log`, see KID-113); if the parent already
  registered but never confirmed, the GoTrue confirmation email is resent
  instead.
- **Forgot / reset password** lives at `/forgot-password` (linked from `/login`).
  It calls Supabase Auth `resetPasswordForEmail`, which sends the recovery email
  and lands on `/reset-password` to set the new password. This works for users
  who have a Supabase (GoTrue) identity — parents who activated an invite and
  staff created with a login email.
- **Interim path when email can't be delivered** (no SMTP / non-routable demo
  addresses): the daycare admin issues a fresh invite code for a parent, or sets
  a new temporary password when adding a staff member. The UI says so explicitly.

## Staff credentials (#14)

The portal's **Staff → Add staff** form now takes a **login email** and a
**temporary password** (with a **Generate** button). Submitting:

1. Creates the staff record (`staff` table).
2. Creates a linked portal account (`account.email` + `account.password_hash`,
   `account.staff_id = staff.id`).
3. Best-effort creates the Supabase Auth identity so the staff member can later
   use **Forgot password** to choose their own password.

The admin shares the email + password with the staff member, who signs in at
`/login` and lands in the portal. Staff without a login email are listed as
"No login yet".

## Access withdrawal with a last date (KID-86 item 9)

Both **child** and **staff** profiles now have a **Last date** field in their
About / Registration section.

- For a **staff** member, the last date withdraws that staff account. On the
  date (or as soon as the system sees the date after it), the staff row is set
  to `active = 0` and the linked account can no longer sign in or load any
  portal/child page.
- For a **child**, the last date sets the child record to `status = 'withdrawn'`
  and `active = 0`. The child disappears from default lists, and a parent whose
  remaining linked children are all withdrawn is also blocked at sign-in and on
  every page load.

The mechanism is intentionally simple and does **not** require an external
scheduler:

1. `runWithdrawalSweep()` updates every row whose `last_date <= today`.
2. `isAccountAccessWithdrawn(accountId)` checks the account.
3. Both the **login action** and the authenticated **portal/child layouts**
   run these checks, so withdrawal takes effect automatically on the date even
   if the user already has a live session cookie.

## Contact relationship roles (KID-112)

Child contacts and parent invites use a **required dropdown** with exactly 4
roles (`lib/contact-relationship.ts`, `components/RelationshipSelect.tsx`) —
free-text relationships are rejected server-side and legacy values were
migrated (`0016_contact_relationship_roles.sql` + SQLite backfill, with
`CHECK` constraints on new writes):

- **Parent** — full access to every `/child` page and write action.
- **Family** — limited access: full read plus pickup loop and messaging, but
  no consent responses, form submissions, incident acknowledgements, or
  support tickets (blocked in `lib/actions.ts` via `assertFamilyAction`).
- **Pickup** — login only to register pickup time: sees only the children
  list, child detail (check-in/out button), and account settings
  (`requireFamilyPage` redirects everything else to `/child`; all write
  actions except `checkInOutAction` are blocked).
- **No access** — login blocked with "account's access is currently disabled"
  (e.g. unpaid fees); existing sessions are redirected to `/login`. Admin use.

The invite's role becomes the `family_member` link role at registration
(`linkFamily(accountId, childId, role)`), and the most permissive link wins
when an account is linked to several children.

## Same-email parent profile backfill (KID-143)

A parent with four children at the daycare should be entered once. When a new
child's contact is added with an email the daycare already knows, any field the
staff member left blank is filled in from that address's existing parent
profile, so the same person is not spelled four different ways across
children.

Implementation: `backfillContactFromSameEmail` (`lib/store.ts`), called from
`addContact` (create) and `updateContact` (edit). It is a pure read followed by
the caller's own write — **no existing row is ever updated**, only the row
being created or edited.

### Fields that are merged

| Field              | Merged | Notes                                                        |
| ------------------ | ------ | ------------------------------------------------------------ |
| `full_name`        | yes    | Falls back to `"—"` when the address is unknown.             |
| `phone`            | yes    | Stored as `null` when neither the submission nor the profile has one. |
| `relationship`     | yes    | Must still resolve to one of the 4 KID-112 enum values.       |

### Fields that are never merged

`email` (it is the match key), `child_id`, `is_pickup` and `is_emergency` —
these are per-child or per-submission facts, not personal profile data. Each
child keeps its own pickup/emergency decision and the address is stored exactly
as submitted.

### Rules

- **Source = the earliest same-email `contact` row** (`ORDER BY created_at ASC`),
  the one created first. A later correction to one child's contact row does not
  become the profile that future submissions copy.
- **Only empty values are filled.** A value the staff member typed is never
  overwritten.
- **Matching is case-insensitive and whitespace-trimmed** on both sides, via the
  shared `normalizeParentEmail` key — `Nouran@Example.com`, ` nouran@example.com `
  and `NOURAN@EXAMPLE.COM` are the same address.
- **Fallback source:** when no contact row exists for the address yet, the
  registered parent `account` full name is used. The account contributes only
  the name; it has no phone or relationship.
- **No address, no backfill.** A contact added without an email is stored
  exactly as typed.
- On **edit**, the row being edited is excluded from the source lookup, so an
  edit can never copy a record into itself.

Matching is not scoped to a single institute: the address identifies the person,
and a parent with children at two centers gets one consistent profile. (That is
about *profile* data — name, phone, relationship — not about access. Access is
gated by the tenant rule in "Which institutes a link may cross" below.)

## What creates a family link

Every `/child/*` page reads the parent's children from **`family_member` only**
(`familiesForAccount`, `lib/store.ts`) — never from `contact`. A row is created
by exactly four things, and nothing else:

| # | Trigger                                             | Code                                                | Role used |
| - | --------------------------------------------------- | --------------------------------------------------- | --------- |
| 1 | A **parent invite is accepted** at `/register`      | `registerAction` → `linkFamily` (`lib/actions.ts`)  | The **invite's** relationship |
| 2 | A **contact is created** on a child                 | `addContact` → `autoLinkSiblingsForContact`         | Each **contact's** relationship |
| 3 | A **contact is edited** (including an email change) | `updateContact` → `autoLinkSiblingsForContact`      | Each **contact's** relationship |
| 4 | The **KID-146 backfill migration**                  | `0018_sibling_family_link_backfill.sql`             | Each **contact's** relationship |

Triggers 2 and 3 grant access to **every child in the institute carrying the
same parent email**, not just the child being edited — that is the sibling
auto-link from KID-142. Trigger 1 covers only the invited child.

`linkFamily` is an upsert on `(account_id, child_id)`, so all four are
idempotent — running one repeatedly keeps exactly one row per pair
(`0017_family_member_unique.sql`).

### The KID-146 backfill

KID-142 added triggers 2 and 3 but only for **future** writes. A child whose
contact was entered before that change has no `family_member` row, so the parent
never saw them and had no way to fix it short of re-typing the data.

Migration `0018_sibling_family_link_backfill.sql` reconciles that existing data:
for every (parent account, child) pair where a contact on that child carries the
account's email **and the child sits at an institute the account already belongs
to**, the missing row is created. Properties:

- **Insert-only.** An existing `family_member` row is never updated, so a role
  an admin set deliberately (a downgrade, or `no_access`) survives.
- **Idempotent and re-runnable.** `ON CONFLICT (account_id, child_id)`, which
  requires the `0017` unique index. Filename ordering applies `0017` first, and
  a `DO $$` guard raises a named error instead of an opaque `42P10` if the index
  is somehow missing.
- **Role** = the contact's `relationship`, falling back to `parent` for anything
  outside the KID-112 enum — the same "never lock a real parent out on bad data"
  default as `normalizeLegacyRelationship`.
- **Case-insensitive, trimmed** on both sides, via the shared
  `normalizeParentEmail` key.
- **Only `role = 'parent'` accounts** are linked; staff/admin accounts never gain
  family access as a side effect.
- **Cross-centre**: `account` carries no institute column, so "the institute this
  account belongs to" is derived, never guessed from the address — see the next
  section. A child is linked only when its **own** contact carries the address
  *and* its centre is in that derived set.
- **Withdrawn children are linked but stay invisible** — `familiesForAccount`
  filters `c.active = 1`, so access returns without a gap if a child is
  reactivated.

The local SQLite fallback mirrors it in `lib/sqlite-schema.ts`, so the behaviour
is exercised by `tests/unit/sibling-family-link-backfill.test.ts` on every run.

### Which institutes a link may cross (KID-149)

`account` has no `institute_id`, so the institutes an account belongs to are
**derived** from first-class records — never from a matching email address:

| Source | Why it counts |
| ------ | ------------- |
| `invite` rows addressed to the account's email | `registerAction` will not create a parent account without an invite code, and the row survives registration with its `institute_id` intact. It is the centre's own record of "this address is a parent here". Status is not filtered: the consumed invite is the one that matters, and a pending invite says the same thing. |
| `family_member` links the account already holds | Access already granted is legitimate by definition, and it anchors parents whose children were enrolled before the invite flow existed. |

A `contact` row is deliberately **not** evidence. A contact can be typed at any
centre for any address, so inferring tenancy from one is the defect itself: the
first version of migration `0018` did exactly that and linked a parent to every
same-email child at every centre. `linkSiblingsByParentEmail` was
institute-scoped in name only — its `instituteId` argument comes from the
*contact's own child*, so it never asked which centres the account belonged to.

The same rule now governs both paths, so a link the runtime refuses is a link
the backfill also refuses:

- **Runtime** — `instituteIdsForAccount` (`lib/store.ts`) and the gate in
  `linkSiblingsByParentEmail`.
- **Backfill** — the `EXISTS` predicate in
  `0018_sibling_family_link_backfill.sql`, and its SQLite mirror.

Two consequences worth stating:

- **A genuinely multi-centre parent is still linked at every centre they are on
  file at.** The derived set is a union, not a single home centre, so enrolling
  a second child at a second centre works — provided the daycare issued an
  invite there or a link already exists. The outcome is evaluated per child, so
  it never depends on row order.
- **The zero-link case.** An account with neither source belongs to no centre
  and gets no links, from the backfill or the runtime. That is a conservative
  miss, not a lockout: the daycare issuing an invite, or a family link being
  made for that account, resolves it immediately.

### The repair half: `0019_institute_scope_repair.sql`

A migration is skipped by filename once it is in the ledger, so fixing `0018`
cannot undo what a database that already applied it wrote. Two files therefore
ship, and both run: `0018` corrected in place, for every database that has not
applied it, and `0019` for the one that has.

`0019` deletes the cross-institute rows the unscoped `0018` wrote, then re-runs
the corrected backfill. Two properties make the delete safe rather than
sweeping:

- **Only rows the bad `0018` could have written are eligible.** `0018` is the
  only writer of a `family_member` id as `md5(...)` — 32 lowercase hex — while
  every application write goes through `uid()`, which always contains a hyphen.
  A hyphenated id is therefore never a candidate, so no link the app made is ever
  at risk, however it looks.
- **A row goes only when the account is not on file at that centre** by either
  first-class source above. Requiring a *non-migration* link for that test is
  what stops a pair of bad rows at one centre from vindicating each other: they
  are both migration-created, so neither counts as evidence, and both go.

The in-institute link `0018` legitimately created is left exactly as it was — not
re-pointed, not re-created under a new id, not re-roled. That row is the sibling
fix a parent is waiting on, so the repair is written to preserve it rather than
re-derive it, and both the SQLite mirror and
`tests/unit/sibling-family-link-backfill.test.ts` assert it survives row for row.

### Measuring this instead of assuming it (KID-152)

`crossInstituteFamilyMemberRows()` (`lib/store.ts`) is the read-only check the
deploy gate runs. It calls no `ensureSchema()` and writes nothing, so it is safe
against production. Two properties make its number worth acting on:

- **It excludes the row under test from the account's own evidence.** A leaked row
  *is* a `family_member` row, so a check that counted every link as justification
  would let a leak justify itself and report `0` on a database that is leaking.
- **It reports `has_other_justification` per row**, the same condition the
  `0019` delete requires. Rows reported with `false` are the ambiguous ones — a
  legitimate lone link whose account has no invite and no other child, from
  before the invite flow existed. Those are for a human to look at, not for a
  sweep to remove.

QA's note that "production Cody measured 0" is not sufficient on its own: with a
single institute a cross-tenant grant is not expressible, so `0` is what a broken
measurement returns too. The gate should read this function's output, and
separately record `SELECT count(DISTINCT institute_id) FROM institute`.

## How database migrations are applied

**Answer: automatically, but lazily — deploying the code does not by itself
apply a new migration, and no manual `psql` step is required.**

- `ensureSchema()` (`lib/db.ts`) is the single runner. In Postgres mode it calls
  `ensurePgSchema()`, which creates a `schema_migrations` ledger table, reads the
  files already recorded, applies every `supabase/migrations/*.sql` file **not**
  in the ledger in filename order, then records each one. Warm requests
  short-circuit on a module-level flag.
- **There is no boot hook** — the project has no `instrumentation.ts`, and no
  layout or page calls `ensureSchema()`. It is called from the server actions in
  `lib/actions.ts` (the portal writes), from `lib/curriculum.ts`, and from
  `npm run db:init` (`lib/seed.ts`).
- Consequence: after a deploy, `0018` applies itself on the **first request that
  runs one of those actions**. Parent-facing reads (`familiesForAccount` on
  `/child/*`) do **not** trigger it, so a deploy that only ever serves page
  views would leave the backfill pending.

**The exact step to make it deterministic** — run this once against the deploy
environment, right after deploying, instead of waiting for an organic write:

```bash
# with the deploy env's KIDDY_DATABASE_URL set to the Supabase pooler URL
npm run db:init
```

`db:init` calls `ensureSchema()` (which applies any pending migration file) and
then re-seeds the demo daycare, which is harmless because `seedDemo` is
idempotent. If you would rather not seed, any single portal write action does
the same job.

The Postgres path was verified end-to-end against a real PostgreSQL 18 server:
the full `0001` → `0018` chain applies cleanly through the same
`splitStatements` splitter `pgExec` uses, `0018` is idempotent across repeated
applications, and the precondition guard raises when `0017` has not been applied.

