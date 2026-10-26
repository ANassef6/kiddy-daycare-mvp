# KID-237 evidence — canonical platform address verified in production

Run stamp: 2026-10-26T17:45Z, head `b864ae7` (deploy `dpl_FHjSdz9NwyrRFceFQBDSfozTjb93`, READY).

| # | Check | Result |
| --- | --- | --- |
| L1 | `https://kiddyapp.net/login` renders on the apex host | pass |
| L2 | Operator sign-in lands on `https://kiddyapp.net/platform` — **same host**, no cross-host bounce | pass |
| L3 | Full operator surface renders: `Daycares` heading, daycare table, Sunshine row | pass |
| L4 | Host consistency: the operator surface is served on `kiddyapp.net` | pass |
| L5 | Operator-only create-daycare form present | pass |
| L6 | Per-daycare "Open daycare" links derive from the canonical apex (`https://sunshine.kiddyapp.net/`, `https://maple-grove-daycare-2.kiddyapp.net/`) | pass |
| L7 | Legacy host `https://kiddy-one.vercel.app/login` still answers 200 (retired from docs/copy, not broken) | pass |

Raw output: `kid237-report.json`. Script: `kid237-verify.mjs` (credentials are
read from run-local temp files at execution time and never appear in source,
report, or screenshots). Screenshots have the operator account identifier
covered; no password material anywhere.

**Landing-path logic needed no fix** — `homeForRole` (`lib/actions.ts`) already
sends the platform-operator role to `/platform`, and the login host gate
exempts the operator on the apex host (`lib/tenant.ts loginHostGate`).
Production behavior confirmed by L2/L4.

**Env:** production `NEXT_PUBLIC_SITE_URL` now `https://kiddyapp.net` (was the
legacy host), set through the Vercel project env API (KID-216/KID-226 flow)
and picked up by this deploy. One console-level 404 resource log during the
pass; not an app error and not host-related.
