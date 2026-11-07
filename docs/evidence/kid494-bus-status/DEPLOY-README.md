# KID-494 (KID-489 item 5) — bus on/off: merge + production deployment record

- PR: #40 (kid494-bus-status → master), checks Vercel pass + Vercel Preview Comments
  pass + Supabase Preview "skipping" (pre-existing 0032 duplicate-migration-version
  ledger condition documented by the KID-491/KID-492 merges — project rename, not a
  deploy gate).
- Merge commit: d26dee5 (2026-11-07, "Merge pull request #40 from
  ANassef6/kid494-bus-status").
- Production deployment: GitHub deployment 7619366387 (sha d26dee5, environment
  Production) → status SUCCESS (created 2026-11-07T09:29:21Z, target
  https://kiddy-hpc8je6py-kiddy2.vercel.app).
- Post-deploy smoke on the live master auto-deploy: https://kiddyapp.net/ → HTTP 200
  and https://kiddyapp.net/login → HTTP 200.
- Implementation + check battery (kid494 suite 12/12, targeted 45/45, tsc/lint/build
  exit 0, db:verify-migrations all-pass, full-suite/shared-workspace interference
  note) in the sibling implement evidence commit efe894a and docs/evidence/README.md
  of this branch.

Credentials/tokens appear nowhere in text, commits or logs. Off-bus safety net is
server-side (close+2h sweep rides the attendance surfaces and the /api/attendance/sweep
cron handle); idempotent replay is pinned by tests, so no live burner verification is
required for the ledger itself.
