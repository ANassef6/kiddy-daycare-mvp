# KID-2455 — message attachments + per-participant thread archive

Status: **complete — staging signed off and production cut finished.**

## What shipped

| Area | Change |
| --- | --- |
| Message attachment columns | `message.attachment_url` / `attachment_name` on both engines (`lib/sqlite-schema.ts` PRAGMA migration + `supabase/migrations/0053_kid2455_message_attachments_archive.sql`). |
| Composer attach control | Staff thread reply, staff direct composer and both parent composers use the shared upload preparation (`lib/media-prepare-client.ts`) with the KID-2450/KID-2453 compression and size/type caps; direct-upload REF first, multipart fallback. |
| Bubble rendering | `components/MessageAttachment.tsx` — inline image preview, file chip with name + download for everything else. Private REFs resolve through the authenticated `storageSrcFor` path. |
| Archive state | Per participant: `message_thread_participant.archived_at` (SQLite mirror + `0053`). Archiving one viewer never hides the thread from the other participants or the parent. |
| Active / Archived filter | Both staff and parent lists; search applies inside the selected list. Archive/unarchive controls on the row and inside the open thread. |
| Auto-unarchive | A new message clears `archived_at` for the recipient. |
| Send state | The send button returns from "Sending…" to "Send" after a successful send even when the redirect keeps the page mounted. |
| Participant names | `threadsForAccount` adds the other participants' names in one batched read. 1:1 rows use the other party's name; group rows add a truncated name line (`Nassef, Nouran, +3`). Staff search matches participant names. |
| Row layout | Row link can shrink (`minWidth: 0`) and the archive control holds its size, so rows stay inside the left column at desktop and mobile widths. |
| i18n | EN + AR: Attach file, Active, Archived, Archive, Unarchive. Names are shared data, labels are localized. |

## Staging

Founder re-test card `a03852e7` accepted 2026-11-20T21:59:16Z. Card 1
(`9f92eb01`) was rejected for the archived-send "Sending…" state and the
Conversations row overflow; both were fixed in `93fbf18` before the accepted
card.

| Item | Value |
| --- | --- |
| Staging branch head | `93fbf18` |
| URL | https://kiddy-staging-orcin.vercel.app |
| Commits | `9cbb747` (attachments + archive), `fc1a1ea` (participant names), `93fbf18` (send state + row overflow) |

## Production cut

Founder sign-off is the accepted staging card above (standing staging-first
rule).

| Item | Value |
| --- | --- |
| Pull request | #79 `kid2455-prod-cut` → `master` |
| Merge commit | `c89d7cb54784988ac31695bd75dc83963f275f60` (2026-11-20T22:29:04Z) |
| Cut branch base | `origin/master` `066b27a` |
| Cherry-picked commits | `7cfd63b` → `caf1997` (KID-2449 parent reply), `9cbb747` → `dd0697e`, `fc1a1ea` → `cfa6cf5`, `93fbf18` → `b0b3936` |
| Extra fix | `8727588` — renumbered `0051_kid2448_bus_cycle.sql` to `0054_kid2448_bus_cycle.sql`; `master` carried two `0051_` files, which the KID-2432 chain test rejects |
| Production deployment | `dpl_B6Mje7bRtRLgPHEaTphhiPjw4yjg` — READY, `production`, 2026-11-20T22:30:19Z |
| Deployment URL | https://kiddy-lhqt64a7n-kiddy2.vercel.app |
| Aliases | `kiddyapp.net`, `*.kiddyapp.net`, `sunshine.kiddyapp.net` |

The cut is a cherry-pick, not a staging merge: `staging` also carries the
unreviewed KID-2454 status-guard work. KID-2449 is `done` and its reply
composer is required by the parent attach path, so its single code commit is
included. Both `0051` migration files were already recorded in the production
`schema_migrations` ledger by filename; `0054` is idempotent
(`ADD COLUMN IF NOT EXISTS`) and only re-runs that guarded statement.

### Gates on the cut branch

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (pre-existing `<img>` warnings only) |
| `npm run build` | green |
| Targeted suites | 136/136 passed — KID-2455, KID-2449, KID-182, KID-207, KID-472 messages/composer, KID-2432 migrations, KID-2448, KID-221 Arabic, KID-169, messaging, KID-171, KID-2450 |
| PR checks | `audit` pass, both Vercel checks pass, Supabase Preview skipped (integration disabled) |

### Production migrations

The app applies `supabase/migrations` on the first authenticated request
(filename-keyed `schema_migrations` ledger). After the deploy, the production
ledger (project `sfetmfmtoubtdyyeyudd`) contains:

- `0053_kid2455_message_attachments_archive.sql`
- `0054_kid2448_bus_cycle.sql`

Column probes through PostgREST returned `200`:

- `message?select=attachment_url,attachment_name&limit=1` → `[{"attachment_url":null,"attachment_name":null}]`
- `message_thread_participant?select=archived_at&limit=1` → `[{"archived_at":null}]`

### Post-deploy smoke check (anonymous)

| URL | Result |
| --- | --- |
| `https://kiddyapp.net/login` | `200` |
| `https://kiddyapp.net/portal/messages` | `307` → `/login` |
| `https://kiddyapp.net/child/messages` | `307` → `/login` |
| `https://kiddyapp.net/api/attendance/sweep` (no secret) | `401` |

Production has no test login for this agent, so the authenticated upload and
archive flows are proven by the founder's staging sign-off plus the production
schema and deployment checks above.

## Founder re-test steps (staging, already signed off)

1. Staff → Messages: attach an image and a non-image file; send both.
2. Parent → Messages: reply with an attachment; staff see the same rendering.
3. Archive a thread; confirm it leaves Active for you and the other party still
   sees it Active. Open Archived → Unarchive.
4. Send a reply from an archived thread: the button returns to "Send" without a
   refresh and the message appears.
5. Confirm each 1:1 row names the other party and group rows show a truncated
   name line; search by a participant name.
6. Switch EN/AR and confirm the labels and names render correctly.
