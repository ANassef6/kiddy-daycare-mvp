# Migrations

One file per numeric version prefix, applied in filename order. The Supabase
CLI ledger (`supabase_migrations.schema_migrations`) keys rows on the numeric
version alone, so two files sharing a prefix fail the Supabase Preview check.
The app ledger (`lib/db.ts`, `public.schema_migrations`) keys on the full file
name. `tests/unit/kid2432-migration-versions.test.ts` pins both rules.

## KID-2506 duplicate-prefix cleanup (2026-11-26)

Parallel branches landed with duplicate numeric prefixes. They were renumbered
order-preserving into the next free versions; contents are unchanged and every
statement is idempotent, so the app re-applying a renamed file is a no-op.

This production cut carries the one rename that affects the production chain:

| Old file | New file |
| --- | --- |
| `0056_kid2483_staff_schedule_date_rooms.sql` | `0062_kid2483_staff_schedule_date_rooms.sql` |

The staging branch also renamed `0055_kid2481_room_photo.sql` to `0061` and
`0056_kid2484_staff_schedule_index.sql` to `0063`; those features are not part
of this cut, so those files are not present here.

`0055_kid2478_bulk_upload.sql` stays `0055` and `0056_kid2480_event_classroom.sql`
stays `0056` — those are the versions the live Supabase ledgers already record.
