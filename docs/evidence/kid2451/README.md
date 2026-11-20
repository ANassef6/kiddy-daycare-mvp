# KID-2451 — read-only production DB size audit + 50x50 growth model

Date: 2026-11-20
Project: Supabase `sfetmfmtoubtdyyeyudd` (`kiddy`, eu-central-1, Postgres 17.6)
Mode: read-only. Every statement below is a `SELECT`; no production row or schema was changed.

## Answer in one line

Today the production database is **20.86 MB**. At 50 daycares x 50 children
(2,500 children), the base case is **~8.7 GB after one year** (text data plus a
modest amount of inline photo media). If drive/message attachments are used at
even a light rate, the same year reaches **~12.8 GB**. Text-only is **~6.7 GB**.
The Pro 8 GB disk allowance is therefore only sufficient if media stops being
stored inside Postgres.

## Method

Queries were executed through the Supabase Management API
`POST /v1/projects/sfetmfmtoubtdyyeyudd/database/query` with `SELECT`-only SQL.
No `INSERT`, `UPDATE`, `DELETE`, `ALTER`, or DDL was run. The database password
was not used.

Key queries:

```sql
-- total database size
select current_database(), pg_database_size(current_database()), version();

-- per-schema size
select n.nspname,
       count(c.oid) as tables,
       coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint as total_bytes
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','m')
group by n.nspname
order by total_bytes desc;

-- per-table size, heap, indexes and TOAST
select n.nspname as schema,
       c.relname as table_name,
       pg_total_relation_size(c.oid) as total_bytes,
       pg_relation_size(c.oid) as heap_bytes,
       pg_indexes_size(c.oid) as index_bytes,
       coalesce(pg_total_relation_size(c.reltoastrelid), 0) as toast_bytes,
       s.n_live_tup as live_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where c.relkind = 'r'
  and n.nspname not in ('pg_catalog','information_schema','pg_toast')
order by pg_total_relation_size(c.oid) desc;

-- exact row counts for the application tables named in the task
select 'child' as t, count(*) from public.child
union all select 'daily_report', count(*) from public.daily_report
union all select 'check_in', count(*) from public.check_in
union all select 'notification', count(*) from public.notification
union all select 'message', count(*) from public.message
union all select 'media', count(*) from public.media;
```

Tuple sizes and attachment payload sizes were measured with
`avg(pg_column_size(row))` and `avg(octet_length(column))`. Those are inputs to
the growth model below.

## Current measured size (2026-11-20)

`pg_database_size('postgres')` = **20,860,051 bytes = 20.86 MB** (19.89 MiB).

| Schema | Tables | Total size | Share |
|---|---:|---:|---:|
| `pg_catalog` (system catalogs) | 64 | 11.81 MB | 56.6% |
| `public` (application) | 65 | 6.83 MB | 32.7% |
| `auth` (GoTrue) | 27 | 1.70 MB | 8.2% |
| `storage` (metadata) | 10 | 0.47 MB | 2.2% |
| `supabase_migrations` | 1 | 0.27 MB | 1.3% |
| `information_schema` | 4 | 0.25 MB | 1.2% |
| `realtime` | 2 | 0.06 MB | 0.3% |
| `vault` | 1 | 0.02 MB | 0.1% |

The column sums slightly exceed `pg_database_size` because of MB/MiB rounding
and free space accounting inside relations.

### Top 15 application tables by total size (heap + indexes + TOAST)

| # | Table | Total | Heap | Indexes | TOAST | Live rows (approx.) |
|---:|---|---:|---:|---:|---:|---:|
| 1 | `newsfeed_post` | 3,080,192 | 8,192 | 16,384 | 3,055,616 | 14 |
| 2 | `tool_usage_event` | 598,016 | 237,568 | 327,680 | 8,192 | 864 |
| 3 | `notification` | 122,880 | 24,576 | 65,536 | 8,192 | 73 |
| 4 | `audit_event` | 114,688 | 16,384 | 65,536 | 8,192 | 51 |
| 5 | `message` | 106,496 | 24,576 | 49,152 | 8,192 | 44 |
| 6 | `enhancement_request` | 98,304 | 8,192 | 81,920 | 8,192 | 3 |
| 7 | `contact_request` | 98,304 | 49,152 | 16,384 | 8,192 | 46 |
| 8 | `account` | 81,920 | 16,384 | 32,768 | 8,192 | 48 |
| 9 | `curriculum_milestone` | 81,920 | 16,384 | 32,768 | 8,192 | 89 |
| 10 | `platform_access_log` | 81,920 | 8,192 | 65,536 | 8,192 | 35 |
| 11 | `branch_billing` | 81,920 | 8,192 | 65,536 | 8,192 | 2 |
| 12 | `invoice` | 65,536 | 8,192 | 49,152 | 8,192 | 4 |
| 13 | `activation_resend_log` | 65,536 | 8,192 | 49,152 | 8,192 | 27 |
| 14 | `notification_pref` | 65,536 | 8,192 | 16,384 | 8,192 | 49 |
| 15 | `form_response` | 65,536 | 8,192 | 49,152 | 8,192 | 6 |

Ties at 65,536 bytes are broken alphabetically; the value is one 8 KB page plus
index pages, so several small tables share the same footprint.

**The single largest application table is `newsfeed_post`.** Two posts with
inline media account for 2,891,834 bytes of the 3,055,616 TOAST bytes, i.e.
**2.89 MB of Base64 image data inside Postgres** for 14 posts. This is the
current, small-scale proof of the media risk described below.

### Main-table row counts (exact)

| Table | Rows |
|---|---:|
| `child` | 16 |
| `daily_report` | 10 |
| `check_in` | 59 |
| `notification` | 73 |
| `message` | 44 |
| `media` | 0 |
| `account` | 48 |
| `family_member` | 27 |
| `enrollment` | 13 |
| `newsfeed_post` | 14 |
| `newsfeed_comment` | 1 |
| `newsfeed_like` | 3 |
| `event` | 3 |
| `bus_event` | 3 |
| `audit_event` | 51 |
| `tool_usage_event` | 864 |
| `incident_report` | 0 |
| `learning_observation` | 4 |
| `homework` | 3 |
| `form_response` | 6 |
| `support_ticket` | 3 |
| `contact_request` | 46 |
| `institute` | 2 |
| `staff` | 7 |
| `branch` | 2 |
| `room` | 5 |
| `drive_file` | 2 |

The production data is a small pilot (16 children, 2 institutes). Current usage
rates are far below a normal operating day (59 check-ins over ~10 weeks), so
extrapolating today's sparse rows would understate the 50x50 steady state. The
model below uses the write patterns in the code, not the pilot's adoption.

## Growth model

### Assumptions

| Assumption | Value | Source |
|---|---:|---|
| Daycares | 50 | task |
| Children per daycare | 50 | task |
| Children total | 2,500 | 50 x 50 |
| Operating days per year | 250 | task |
| Check-in/out events per child per day | 2 | task (`check_in` in/out) |
| Daily reports per child per operating day | 1 | `daily_report` unique `(child_id, report_date)` |
| Guardians per child | 1.7 | measured: 27 family members / 16 children |
| Staff per daycare | 8 | 400 total; ~1:6 ratio |
| Pickup-time teacher recipients per child | 2 | `notifyTeachersPickupTime` fans out to the child's room teachers |
| Newsfeed posts per daycare per day | 1 | 12,500/year |
| Share of posts with a photo | 30% | model assumption |
| Compressed photo in Base64 | 533 KB | KID-2450 target 400 KB x 4/3 Base64 expansion |
| Messages per child per week | 1 | 130,000/year |
| Invoice notifications per child per year | 12 | monthly billing |
| Bus riders | 20% of children, 2 events/day | model assumption |

Per-row storage uses measured tuple sizes plus index/page overhead. The anchor
is `tool_usage_event`: 123 B tuple, 4 btree indexes, measured 691 B total on
disk per row. Applying the same 2.2x heap overhead + ~95 B per index per row:

| Table | Measured tuple | Indexes | Modeled bytes/row (heap + indexes) |
|---|---:|---:|---:|
| `notification` | 281 B | 4 | 950 B |
| `audit_event` | 236 B | 4 | 850 B |
| `check_in` | 115 B | 2 | 420 B |
| `daily_report` | 350 B | 2 | 900 B |
| `message` | 193 B | 3 | 700 B |
| `tool_usage_event` | 123 B | 4 | 700 B |

These are steady-state marginal costs. The current small tables show much
higher bytes/row (for example `daily_report` is 49 KB for 10 rows) because one
8 KB page dominates; that is not a growth rate.

### Rows and GB per year at 2,500 children

| Table | Write driver and arithmetic | Rows/year | Bytes/row | GB/year |
|---|---|---:|---:|---:|
| `check_in` | 2,500 children x 250 days x 2 events | 1,250,000 | 420 | 0.53 |
| `daily_report` | 2,500 x 250 days x 1 report | 625,000 | 900 | 0.56 |
| `notification` | see breakdown below | 3,481,000 | 950 | 3.31 |
| `audit_event` | 1.25M check-ins + 625k reports + 130k messages + 12.5k posts + 30k invoices + 100k other edits | 2,147,500 | 850 | 1.83 |
| `message` | 2,500 children x 52 weeks | 130,000 | 700 | 0.09 |
| `tool_usage_event` | 400 staff x 2 events/day x 250 days | 200,000 | 700 | 0.14 |
| `newsfeed_post` (text) | 50 daycares x 250 days | 12,500 | 1,000 | 0.01 |
| `newsfeed_post` (media) | 12,500 x 30% x 533 KB Base64 | 3,750 | 533,000 | 2.00 |
| Other app tables (child, account, family, staff, enrollment, rooms, etc.) | 2,500 children + ~4,700 accounts | - | - | 0.07 |
| `auth` growth (sessions, tokens, identities) | ~4,700 accounts; expiring token churn | - | - | 0.15 |
| Fixed system catalogs | current `pg_catalog` + storage metadata | - | - | 0.02 |

**Notification breakdown (3,481,000 rows/year):**

- Daily report fan-out: 625,000 reports x 1.7 guardians = 1,062,500
- Pickup-time teacher fan-out: 2,500 children x 250 days x 2 teachers = 1,250,000
- Newsfeed/announcement fan-out: 12,500 posts x 51 average recipients = 637,500
  (half center-wide to 85 parents, half tagged to ~10 children / 17 parents)
- Message notifications: 130,000
- Bus notifications: 2,500 x 20% x 2 events x 250 days = 250,000
- Invoice notifications: 2,500 x 12 months x 1.7 guardians = 51,000
- Auto-checkout notifications: 400 staff x 250 days = 100,000

**Totals after one year:**

| Case | GB |
|---|---:|
| Text-only (no inline media) | 6.68 |
| Base: text + 30% of posts with a compressed photo | **8.68** |
| Base + light drive attachments (1 file/daycare/week, ~1 MB avg) | 12.14 |
| Base + drive + message-thread attachments (5% of threads at 0.5 MB) | **12.79** |

Add roughly 10-15% for page bloat, dead tuples and free space that autovacuum
has not returned yet: plan for **~9.5-10 GB** in the base case and **~14 GB** in
the attachment case.

### Tier comparison

| Tier | Included disk | Base case (8.7 GB) | Attachment case (12.8 GB) |
|---|---:|---|---|
| Free | 500 MB | Exceeded in the first weeks/months | Exceeded in the first weeks/months |
| Pro | 8 GB + $0.125/GB overage | ~0.7 GB over (~$0.09/month) | ~4.8 GB over (~$0.60/month) |
| Team | 8 GB (same disk model) | Same as Pro | Same as Pro |

The dollar overage is small. The operational risk is not the $0.60/month: it
is running out of disk headroom, longer backups/restores, and the fact that
`newsfeed_post`/`drive_file` can jump by gigabytes in a single busy week.

## Flags: tables that dominate or grow without bound

1. **`newsfeed_post.media_url` — highest byte risk.** The newsfeed action stores
   an uploaded photo/video as a `data:<mime>;base64,...` string directly in the
   column (`lib/actions.ts:4293`). Current proof: 2 posts hold 2.89 MB, 99% of
   the table's size. Base model: 2.0 GB/year; uncompressed 2.5 MB uploads would
   be 12.5 GB/year for the same 3,750 posts.
2. **`drive_file.url` — same pattern, larger cap.** Drive uploads are Base64
   data URLs in Postgres (`lib/actions.ts:3260`), capped at 4 MB per file. One
   file per daycare per week at ~1 MB average is 3.5 GB/year; at the 4 MB cap it
   is 13.9 GB/year.
3. **`message_thread.attachment_url` — same pattern.** A 1.5 MB cap per thread
   (`lib/actions.ts:3490`), stored on the thread. At 5% of ~26,000 threads with a
   0.5 MB average, 0.65 GB/year; worst case is much higher.
4. **`notification` — highest row growth.** 3.5M rows/year because one event
   fans out to every guardian and every classroom teacher. No retention job
   exists; rows are add-only. This is 3.3 GB/year by itself.
5. **`audit_event` — add-only by design.** ~2.1M rows/year, no delete path.
   1.8 GB/year. The audit page only reads recent rows, so old rows are cold.
6. **`check_in` — highest raw event count.** 1.25M rows/year, 0.53 GB/year, no
   archival. Needed for attendance history, but old years can be partitioned or
   archived.
7. **`tool_usage_event`** — 200k rows/year and 0.14 GB/year at normal use; less
   urgent, but it is analytics data with no retention policy.

### Suggested retention/archival notes (not implemented)

- Move all Base64 media out of Postgres into Supabase Storage; keep only the
  object key/URL (tens of bytes) in `newsfeed_post`, `drive_file`, and
  `message_thread`. This is the single biggest lever: it converts DB disk into
  cheaper object storage and keeps the 8 GB DB allowance usable.
- `notification`: delete or archive **read** rows older than 90 days; keep
  unread rows indefinitely. At steady state this removes most of the 3.3 GB/year.
- `audit_event`: keep 12-24 months hot; export older rows to cold storage
  (or a partitioned archive table) because only the admin audit page reads them.
- `check_in`: keep current + prior school year hot; archive older years. If
  retention is a product requirement, partition by school year instead of
  deleting.
- `tool_usage_event`: roll up to daily per-tool aggregates after 90-180 days.
- Add a per-daycare storage quota and a media retention policy; the current
  per-file caps (2.5 MB newsfeed, 4 MB drive, 1.5 MB message) bound one file but
  not the number of files.

## Caveats

- The model assumes full daily operation (250 school days, every child checked
  in/out, one report per child per day). The pilot currently runs far below
  that. A 50%-adoption year would be roughly half the row-driven total.
- Bytes/row are modeled from measured tuples and index counts, not from a
  loaded 2,500-child database. Expect ±15% before bloat.
- `pg_database_size` excludes WAL and Supabase Storage object bytes. Base64
  media is inside the database; object-storage media is not.
- No production data was modified. All access was `SELECT`-only.
