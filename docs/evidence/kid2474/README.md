# KID-2474 — staging capture accounts for Wren (KID-2471)

Two synthetic staging accounts for Wren's handbook screenshot runs live in the
existing **Founder Test Daycare** fixture, beside the teacher login Wren
already uses.

| Purpose | Email | Role | Notes |
| --- | --- | --- | --- |
| Admin capture | `wren.admin@example.test` | `admin` | Linked admin `staff` row in Founder Test Daycare |
| Parent capture | `wren.parent@example.test` | `parent` | Linked to Layla Founder and Omar Founder |

The passwords are recorded **only** in the courier task assigned to Wren; they
are not in this repository or any task comment. Both accounts are
email-confirmed, never flagged for a password change, and have no GoTrue
identity — exactly like the existing staging fixtures, sign-in falls back to
the app-side password hash. The accounts are stable and idempotent: rerunning
`scripts/provision-staging-capture-accounts.ts` updates the same rows.

## Provisioning

`scripts/provision-staging-capture-accounts.ts` carries the same
production-refusal guard as `scripts/seed-staging-founder.ts`. It requires the
staging project ref plus `WREN_ADMIN_PASSWORD` / `WREN_PARENT_PASSWORD`, so no
credential is committed.

```bash
KIDDY_SEED_STAGING_PROJECT=pjubkhhuccoqboypgpty \
KIDDY_DATABASE_URL="<staging Postgres URL>" \
WREN_ADMIN_PASSWORD="<admin password>" \
WREN_PARENT_PASSWORD="<parent password>" \
npx tsx scripts/provision-staging-capture-accounts.ts
```

## Verification (staging, 2026-11-24)

Host: `https://kiddy-staging-orcin.vercel.app`

| Check | Result | Evidence |
| --- | --- | --- |
| Admin signs in via `/login` | `/portal/dashboard`, heading "Dashboard" | [`01-admin-home-en.png`](01-admin-home-en.png) |
| Parent signs in via `/login` | `/child`, shows Layla Founder + Omar Founder | [`01-parent-home-en.png`](01-parent-home-en.png) |
| Admin EN → AR → EN switch | `dir=rtl` + Arabic copy, then `dir=ltr` English | [`02-admin-switched-ar.png`](02-admin-switched-ar.png), [`03-admin-back-en.png`](03-admin-back-en.png) |
| Parent EN → AR → EN switch | `dir=rtl` + Arabic copy, then `dir=ltr` English | [`02-parent-switched-ar.png`](02-parent-switched-ar.png) |
| Account rows | role, confirmation, temp-password flag, child links verified in the staging DB | — |
| Idempotent rerun | same account/staff/child-link ids, no duplicates | — |

`tsc --noEmit` passes on the staging branch worktree. Staging only; production
is untouched and no migration was added.
