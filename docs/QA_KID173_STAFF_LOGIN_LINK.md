# KID-173 — production evidence for `0020_staff_login_link.sql`

Recorded 2026-10-05. This is the delivery record for KID-173: what was applied, how
many rows it changed, and the browser pass that shows a parent can use the result.
It replaces prose assertions with the outputs behind them.

## Artifacts

One commit on `master` carries all three deliverables:

| Path | Role |
| --- | --- |
| `supabase/migrations/0020_staff_login_link.sql` | the repair (a single `UPDATE`) |
| `lib/sqlite-schema.ts` | hand-maintained SQLite twin, so SQLite tests exercise the same behaviour |
| `tests/unit/kid173-staff-login-link.test.ts` | behavioural coverage of the safety properties |

`origin/master` = `1a96f1ff5e49176e58bbd5f73d714837e732e17e`, and that tree contains all
three paths. The same commit also renames `0003_t5.sql` to `0004_t5.sql`, which removed
the duplicate-version failure in the Supabase-hosted migration pipeline.

## Applied, from the live ledger

Read-only query against the production ledger returned 19 rows, and every row maps
one-to-one onto a filename on `master`:

```
0001 init                 0007 round4        0013 kid86_lastdate   0019 institute_scope_repair
0002 email_confirmed      0008 curriculum     0014 parent_invite    0020 staff_login_link
0003 contact_request      0009 center_details 0015 activation_resend
0004 t5                   0010 round6         0016 contact_relationship_roles
0006 round3_hardening     0011 kid53          0017 family_member_unique
                          0012 kid55_messaging 0018 sibling_family_link_backfill
```

No ledger row lacks a file, and no file lacks a ledger row. `0020_staff_login_link` is
present, so the migration ran in production.

## Rows changed: exactly 1

The number matters, because a migration that reports success while repairing nothing is
the failure this issue was opened for. Before the migration, QA read exactly two accounts
with `staff_id` set (`bluestaff` and `staff.round5.1165531`). After it, production holds
exactly three:

| account | role | staff record | rooms |
| --- | --- | --- | --- |
| `admin@sunshinedaycare.test` | owner | **Maria Lopez** | Toddlers, Preschool |
| `trois4ever+bluestaff@gmail.com` | staff | bluestaff | manual test |
| `staff.round5.1165531@kiddy-test.eg` | staff | Round5 Staff 1165531 | (none) |

Three minus two is **one** account linked: the existing owner login to the staff record
that already existed for it. No account was created, no credential was created, and every
`parent` account on production still reads `(unlinked)`.

The harness prints `0020 rows changed on the seeded shape: 4`. **That number is
synthetic** — it comes from a deliberately two-institute fixture (`acc-maria`, `acc-x2`,
`acc-crosscare`, `acc-far`) that exists to exercise the tenancy rules. It is not the
production count and must not be quoted as one.

### One thing this evidence does not establish

The `UPDATE` can authorise a link through either the tenancy branch (`invite` /
`family_member` proving the account belongs to the staff record's institute) or the
single-institute fallback. The outputs above prove the join is inside Sunshine Daycare,
because Maria Lopez's rooms are Sunshine's rooms. They do not say which branch fired,
because the output never included the production institute count. Nothing in the D2 pass
depends on that, and no cross-institute link occurred.

## D2 browser pass — 8 of 9 checks pass

Production is `https://kiddy-one.vercel.app`. The script is
`docs/evidence/kid173/d2-check.mjs`; raw output is `docs/evidence/kid173/d2-report.json`.
Both demo logins are the ones the app itself prints on `/login`, so the pass needs no
private credential.

| # | Check | Result | Detail |
| --- | --- | --- | --- |
| P1 | Parent signs in and lands on `/child` | pass | `parent@example.test` → `/child` |
| P2 | `/child/messages` renders a recipient control | pass | `data-testid="messages-no-staff"` absent, one option |
| P3 | **Maria Lopez appears as a recipient** | pass | recipient options: `["Maria Lopez"]` |
| P4 | Send is accepted, no refusal banner | pass | back on `/child/messages`, no `data-testid="messages-error"` |
| P5 | The message is stored and visible after a full reload | pass | body `KID-173 D2 check 2026-10-05T18-16-51-135Z` re-read from the server |
| S1 | Owner signs in and lands on `/portal/dashboard` | pass | `admin@sunshinedaycare.test` |
| S2 | **The owner receives the parent message** | pass | same unique body present on `/portal/messages` |
| S3 | Maria Lopez's staff row shows the linked login | pass | row reads `admin@sunshinedaycare.test`, rooms `Preschool, Toddlers` |
| S4 | No staff row reads "No login yet" | **fail** | 1 row still does — explained below |

P5 and S2 are the same message found from both ends, which is why P5 is checked after a
full page reload rather than from optimistic DOM state.

### S4 is correct behaviour, not a regression

`/portal/staff` still reads `No login yet` for exactly one record: `TS / test staff`,
a carer in Preschool with no login of its own — a leftover from an earlier QA round
(`docs/evidence/kid173/portal-staff-linked.png`). `0020` joins a login that exists to a
staff record that exists. It never invents a login, so a staff row with no account must
keep reading `No login yet`. That row is also not the one this issue is about.

The three rows that had logins before the migration are unchanged: `bluestaff` still
reads `trois4ever+bluestaff@gmail.com` in `manual test`, and `Round5 Staff 1165531` is
still linked and still roomless.

### Two observations that are not KID-173

- The parent page logs one 404. It is `/favicon.ico` (also `/manifest.json` and
  `/apple-touch-icon.png`), confirmed by direct request. Cosmetic and pre-existing.
- `admin@sunshinedaycare.test` signs in as `owner` while Maria's staff record is `Admin`.
  The two roles are separate columns and the migration does not touch `account.role`.

## Reproducing the browser pass

Not part of CI; it needs a Chromium binary and `playwright-core`, neither of which is a
project dependency.

```bash
npm i -D playwright-core
# Chromium plus its shared libraries must already exist on the machine.
LD_LIBRARY_PATH=/path/to/chrome/libs OUT_DIR=./out node docs/evidence/kid173/d2-check.mjs
```

The script writes one PNG per state into `$OUT_DIR` and exits non-zero if any check fails.