# KID-2485 — Surveys: recipient selection

## What changed

- The survey composer (`/portal/surveys`) now includes the shared
  `RecipientsPicker`: search, one admin-only "Everyone (whole center)" channel
  (unchecking a classroom narrows it; no duplicate "All classrooms" option),
  classroom checkboxes, and individual child picking with search.
- The picker's unified rules from KID-2482 ship here too, because KID-2485
  depends on them for the surveys UI.
- The Smart Form builder (`/portal/forms`) gets the same picker because it can
  also create `kind = survey` rows. The picker is only required for surveys.
- `createFormAction` resolves the audience with the same helper activities and
  the newsfeed use (`resolveRecipientAudience`), so:
  - a forged whole-center channel from staff is refused,
  - requested classrooms and children are narrowed to the centre and the
    staff member's assigned classrooms,
  - the whole-center audience is resolved at submit time (new classrooms and
    unassigned children are included).
- A survey cannot be saved without a channel or recipient; the action redirects
  back with `error=form-recipients` and writes nothing.
- Each survey card shows its audience (Everyone / Classrooms / Children) in
  EN and AR.
- `/child/forms` shows a targeted survey only to families with a child in the
  resolved audience.

## Legacy surveys (documented choice)

`audience_channel` is nullable. Rows created before this change keep `NULL`,
which the app treats as **center-wide** — the old behavior — so every family
that could see those surveys still sees them. Forms and lists also keep `NULL`
and stay available to everyone.

## Schema

`supabase/migrations/0057_kid2485_survey_audience.sql` adds:

- `audience_channel` — `center` | `rooms` | `children` (NULL = legacy)
- `audience_room_ids` — JSON array of picked classroom ids
- `audience_child_ids` — JSON array of resolved child ids

The SQLite mirror in `lib/sqlite-schema.ts` has the same columns plus the
idempotent `ALTER TABLE` backfill for existing local databases.

## Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx next lint` (changed files) | no warnings/errors |
| `npx vitest run tests/unit/kid2485-survey-recipients.test.tsx` | 13/13 pass |
| Existing KID-368 AR page coverage, KID-2413 validation, KID-472 audit, i18n page coverage | 38/38 pass |
| `npm run db:verify-migrations` | all migration checks passed (PGlite) |

The new suite pins: no-recipient refusal, center resolution/storage, staff
forged-center refusal, classroom scoping, out-of-scope child drop, child
audience storage, audience labels, legacy center-wide visibility, targeted
visibility for a family outside the audience, and the unified picker options.

## Rollout

Staging branch first. Production cut stays gated on founder sign-off.
