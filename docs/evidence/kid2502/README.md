# KID-2502 — staff check-in notifications + staff admin page removal

Date: 2026-11-26. Author: Cody.

## What shipped

- `logStaffStatus` emits one in-app notification per owner + admin account on
  staff `checkin` and `out`. The acting account is excluded. Sick, vacation,
  absent and child_sick stay silent. Copy is EN + AR and includes the staff
  name, the locale-formatted timestamp, and the note when present.
- `/portal/staff/schedule` and `/portal/staff/hours` redirect non-admin
  sessions to their own profile (`/portal/staff/<ownStaffId>`). The sidebar
  shows both items to owner/admin only, and the dashboard/profile
  "manage schedule" links are admin-only.
- Staff keep their own schedule on the profile Calendar tab (unchanged).
- Staff can now select "Checked out" (`out`) in the status card, so the
  check-out path is reachable from the UI.

Code commit: `8019d39` (`KID-2502: notify owners/admins on staff check-in and
check-out`), merged into `staging`.

## Automated checks (local, staging-based branch)

```
npx tsc --noEmit                       # clean
npx next lint                          # no errors (existing <img> warnings only)
npx vitest run \
  tests/unit/kid2502-staff-checkin-notifications.test.ts \
  tests/unit/kid2502-staff-access.test.tsx
  # 12 passed

npx vitest run \
  tests/unit/kid2483-staff-schedule-page.test.tsx \
  tests/unit/kid2483-staff-schedule.test.ts \
  tests/unit/kid2413-qa-bugs.test.tsx \
  tests/unit/i18n.test.ts \
  tests/unit/i18n-page-coverage.test.ts
  # 39 passed
```

Coverage includes: recipient fan-out (owner + admin, actor excluded), silent
non-check-in kinds, EN/AR copy parity, notification/push deep links, server
role redirects, sidebar visibility, and the admin pages still rendering.

## Staging deployment

- Worker `kiddy-web-staging`, first deployed from this change as version
  `4149e65a-48df-4394-9e60-ba89b1285f77` at 2026-11-26T16:54Z.
- Other KID tasks merged into `staging` immediately after and redeployed the
  same Worker. The KID-2502 commit is in `origin/staging` history; the live
  staging Worker therefore carries it (confirmed by the owner/teacher checks
  below).
- For immutable verification, the exact KID-2502 build was also uploaded as
  Worker version `0665554f-d0e3-4cd6-88ff-ce778043cb70`, preview URL
  `https://0665554f-kiddy-web-staging.trois4ever.workers.dev`. Every check
  below ran there; the same behaviour was then confirmed on
  `https://staging.kiddyapp.net` for the sidebar and notification surfaces.

Note: while verifying, `staging.kiddyapp.net` briefly served the app error
boundary after another concurrent staging deployment; the isolated preview
version stayed healthy. No KID-2502 code was rolled back.

## Live verification (real browser, staging fixtures)

Teacher `founder.teacher@staging.kiddy.test`:

- Sidebar Staff group: **Staff profile only**. `Staff schedule` and
  `Working hours` are absent.
- Staff profile still shows the **Calendar** tab, the current-status card, and
  the status options including **Checked out**.
- Selected **Checked in** with note `KID-2502 staging check-in`: badge became
  `Checked in`, note and `Since 26 Nov 2026, 19:30` rendered.
- Selected **Checked out** with note `KID-2502 staging check-out`: badge became
  `Checked out`, note and `Since 26 Nov 2026, 19:40` rendered.

Owner `founder.owner@staging.kiddy.test`:

- Sidebar Staff group shows **Staff profile**, **Staff schedule**, and
  **Working hours**.
- `/portal/staff/schedule` renders heading **Staff schedule** (admin form).
- `/portal/staff/hours` renders heading **Working hours** (admin table).
- Notifications page shows:
  - `Staff check-in: Nour Teacher` — `At 26 Nov 2026, 19:30 · Note: KID-2502 staging check-in`
  - `Staff check-out: Nour Teacher` — `At 26 Nov 2026, 19:40 · Note: KID-2502 staging check-out`

The direct-URL redirect for non-admin staff is pinned by the unit suite
(`kid2502-staff-access.test.tsx`), because the browser tool cannot type into
the address bar; the rendered sidebar/profile evidence above confirms the
same role boundary from the UI.

## Screenshots

| File | View |
| --- | --- |
| `teacher-profile-no-admin-nav.png` | Teacher profile sidebar without the two items; Calendar + status control |
| `teacher-checkin-status.png` | Teacher checked in with the staging note |
| `teacher-checkout-status.png` | Teacher checked out with the staging note |
| `owner-checkin-notification.png` | Owner notification list with the check-in entry |
| `owner-checkout-notification.png` | Owner notification list with the check-out entry |
| `owner-staff-schedule-page.png` | Owner still reaches the Staff schedule page |
| `owner-working-hours-page.png` | Owner still reaches the Working hours page |
