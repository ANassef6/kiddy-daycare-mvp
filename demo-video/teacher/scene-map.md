# Teacher demo — scene map

Role: teacher/staff · Tenant: Sunshine (`https://sunshine.kiddyapp.net`) · 1920x1080 @ 30 fps

| Scene | Tool | Route | Auth | EN | AR |
| --- | --- | --- | --- | --- | --- |
| 01-login — Sign in | Authentication | `/login` | no | 11.1s | 8.6s |
| 02-dashboard — Dashboard | Home dashboard | `/portal/dashboard` | yes | 10.7s | 8.6s |
| 03-children — Children | Child list | `/portal/children` | yes | 9.5s | 8.6s |
| 04-child-daily-report — Daily report | Child profile / daily report | `/portal/children/[id]?tab=daily` | yes | 12.3s | 8.6s |
| 05-child-about — Child details | Child profile / about | `/portal/children/[id]?tab=about` | yes | 9.9s | 8.6s |
| 06-child-family — Family and pickup | Child profile / family | `/portal/children/[id]?tab=family` | yes | 9.5s | 10.0s |
| 07-child-media — Child media | Child profile / media | `/portal/children/[id]?tab=media` | yes | 9.9s | 7.7s |
| 08-child-documents — Child documents | Child profile / documents | `/portal/children/[id]?tab=documents` | yes | 7.4s | 6.8s |
| 09-child-schedules — Child schedule | Child profile / schedules | `/portal/children/[id]?tab=schedules` | yes | 8.2s | 6.8s |
| 10-child-learning — Child learning history | Child profile / learning history | `/portal/children/[id]?tab=learning` | yes | 7.4s | 8.2s |
| 11-child-incidents — Child incidents | Child profile / incidents | `/portal/children/[id]?tab=incidents` | yes | 8.2s | 8.2s |
| 12-attendance — Attendance and bus | Attendance | `/portal/attendance` | yes | 13.1s | 10.4s |
| 13-consents — Consents | Consents | `/portal/consents` | yes | 10.7s | 9.5s |
| 14-incidents — Incident reports | Incidents | `/portal/incidents` | yes | 9.9s | 8.2s |
| 15-newsfeed — Newsfeed | Newsfeed | `/portal/newsfeed` | yes | 10.7s | 9.5s |
| 16-messages — Messages | Messages | `/portal/messages` | yes | 9.9s | 9.5s |
| 17-calendar — Calendar | Calendar | `/portal/calendar` | yes | 8.2s | 6.8s |
| 18-events — Events | Events | `/portal/events` | yes | 9.1s | 7.3s |
| 19-drive — Parent drive | Parent drive | `/portal/drive` | yes | 9.9s | 9.1s |
| 20-learning — Development observations | Learning | `/portal/learning` | yes | 10.3s | 8.6s |
| 21-activities — Activities | Learning / activities | `/portal/learning/activities` | yes | 10.7s | 6.8s |
| 22-homework — Homework | Learning / homework | `/portal/learning/homework` | yes | 9.1s | 6.4s |
| 23-staff-profile — My staff profile | Staff / own profile | `/portal/staff` | yes | 9.5s | 6.8s |
| 24-staff-schedule — My schedule | Staff / schedule | `/portal/staff/schedule` | yes | 7.8s | 6.8s |
| 25-working-hours — Working hours | Staff / working hours | `/portal/staff/hours` | yes | 6.2s | 6.0s |
| 26-notifications — Notifications | Notifications | `/portal/notifications` | yes | 8.2s | 7.7s |
| 27-account — Account settings | Account | `/portal/account` | yes | 7.8s | 6.4s |
| 28-wrap — Close | Summary | `/portal/dashboard` | yes | 7.8s | 7.3s |

Exclusions and reasons live in `scenes.teacher.json` (`excluded`).
