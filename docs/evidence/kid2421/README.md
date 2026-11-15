# KID-2421 — Arabic-locale English page bodies (founder screenshots)

Date: 2026-11-15 · Status: **fixed** · Branch: `kid2400-full-arabic-localization`

## Root cause

Not a missing translation. The KID-2400 localization work (commit `01754e3`) and
its evidence (`38a76e9`) were present on the local branch, but the remote branch
`origin/kid2400-full-arabic-localization` had been rebuilt on top of `master`
(`01b311e`) with only the four KID-2413 bug-fix commits (`4e44ed7`…`dfeaf74`).
That remote branch was what the preview deployed, so:

* the portal shell/sidebar rendered Arabic from the account language, and
* every page body fell back to the English dictionary because the page-level
  localization commit was absent.

That is exactly the founder's symptom: Arabic sidebar, English bodies, while
`/portal/staff/hours` rendered (KID-2413 bug 1 live) — proof the branch was
KID-2413 but not KID-2400.

## Fix

Merged `origin/kid2400-full-arabic-localization` into the local branch and
resolved the KID-2413 overlap so the result keeps **both**:

* all KID-2400 page localization + KID-2401 Arabic copy review, and
* the KID-2413 fixes (hours 500, dict paths, role labels, notification labels,
  locale dates, policy refusals, server-side validation), and
* the newer master work that only existed on the remote base (KID-2406 edge
  cache, KID-2407 contact-notify, `vercel.json`, nav-perf tests).

Cleanup in the merged tree:

* removed the superseded KID-2413 `lib/policy-i18n.ts` adapter and its test;
  the shipped path is `lib/policy-messages.ts` (used by actions + mobile
  check-in) on the `policy.*` keys.
* consolidated the duplicated `policy` dictionary section (EN + AR) into one
  and added `policy.parentCheckInDisabled`, used by the mobile check-in route.
* removed the duplicated `incidents.incidentDescriptionRequired` key; the
  rendered banner uses `profile.incidentDescriptionRequired`.
* updated the KID-2413 server-validation pin to the shipped hyphenated error
  codes (`error=form-title`, `error=incident-description`).

## Per-page fix list (the nine founder screenshots)

| Page | Route | Dictionary groups now used |
|---|---|---|
| Children | `/portal/children` | `common.children`, `childrenAdd.*` (`enrolledCount`, `statusColon`, filter chips, `allergiesLabel`, `noChildrenMatch`), `profile.active/onHold/pending/withdrawn` |
| Attendance | `/portal/attendance` | `attendance.*` (`title`, `subtitle`, `allRooms`, `filter`, `clear`, `searchPlaceholder`, `colBus`, `busOn/off`, `absent`, `empty`), `attendees.checkedIn/checkedOut/checkIn/checkOut` |
| Staff & access | `/portal/staff` | `staff.*` (`title`, `subtitle`, `accessRoles`, `searchPlaceholder`, `allRoles`, `apply`, `clear`, columns, `setStatusBtn`, `profileBtn`), `roles.owner/admin/carer`, `staff.roleTeacher/roleCaregiver` |
| Staff schedule | `/portal/staff/schedule` | `staff.*` (`scheduleSubtitle`, `addShiftTitle/Btn`, `emptyShifts`, `notesPlaceholder`, `removeBtn`), `nav.staffSchedule`, `settings.day` |
| Working hours | `/portal/staff/hours` | `staff.*` (`hoursSubtitle`, `centerOpeningHours`, `perStaffHeading`, `noStaffYet`, `noOpeningHours`, `trackingNote`), `nav.workingHours`, `activities.end` |
| Smart lists | `/portal/tags` | `smartList.*` (`savedLists`, `createListBtn`, `colListName`, `colDateCreated`, `colOpen`, `emptySavedLists`, `untitledList`, `downloadCsvBtn`, `addColumnLabel`, `fEnrolledAfterLabel`, `fMaxAgeLabel`, `apply`, `colDobAge`) |
| Forms list | `/portal/forms` | `formsAdmin.*` (`pageTitle`, `pageSubtitle`, `buildNewForm`, `allFormsLink`, `searchInquiriesPlaceholder`, `apply`, `clear`, columns, `regenerateLink`, `viewSubmissions`, `publishBtn`, `funnel*`, `typeForm/Survey/List`) |
| Surveys | `/portal/surveys` | `surveysAdmin.*` (`title`, `subtitle`, `createSurvey`, `titleLabel`, `descriptionLabel`, `questionsHeading`, `questionType`, `optionsHint`, `requiredLabel`), `forms.kindSurvey` |
| Finance | `/portal/finance` | `finance.*` (tabs, status cards, `bulkInvoice`, `export`, search, `allStatuses`, `apply`, table headers, status pills) |

All bare date/time rendering on these pages goes through `fmtDateFor` /
`fmtTimeFor` / `fmtDateTimeFor`, so dates follow `ar-EG` in Arabic.

## Verification (this run)

Environment: private copy of the KID-2414 seeded fixture DB, `next dev` on
`127.0.0.1:4125`, accounts switched with the real `account.language` column,
session cookies minted with the app's `createSessionToken`.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | exit 0 (pre-existing `<img>` warnings only) |
| `npm run build` | exit 0 |
| Targeted vitest (i18n, page-coverage guard, KID-2413 QA, policy/boundaries, KID-2406/2407, KID-368/494/683) | 13 files / 174 tests passed |
| AR render scan, 9 routes below | `dir=rtl lang=ar`, 0 English dictionary hits, 0 `MISSING:` markers |
| EN render scan, 9 routes below | `dir=ltr lang=en`, 0 Arabic residue |

The only raw-English text left in the scans is user-entered fixture data
(a form description, an incident note, seeded curriculum text) — excluded per
the KID-2402 allowlist.

Scan JSONs: [`scans/`](./scans). Founder screenshots: [`screenshots/`](./screenshots).
