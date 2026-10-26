# KID-239 — Login page demo-credentials hint removed (pre-launch)

Run stamp: 2026-10-26T21:47Z, head `06582a4` (deploy `dpl_D9mzA7PrZcx8LenzBUhmsZESNfu4`, READY, production alias `https://kiddyapp.net`).

## What changed

- `app/login/page.tsx`: removed the hardcoded unconditional
  `<p className="muted small mt-3">Demo: … / kiddy-admin (portal) · parent@example.test / kiddy-parent (parent)</p>`
  block entirely. No env gate. Register link (`Have an invite code? Activate your account` → `/register`),
  forgot-password link, and all login/tenant-guard behavior unchanged byte-for-byte.
- `tests/unit/kid239-login-no-demo-credentials.test.tsx` (new): pins the removal — renders `/login`
  and asserts zero occurrences of `Demo:`, `admin@sunshinedaycare.test`, `parent@example.test`,
  `kiddy-admin`, `kiddy-parent`, and that the `/register` link survives.
- Sweep of `app/` + `components/` for the same strings: the login page was the only user-facing
  rendering surface; no other occurrences existed (test fixtures and seed data intentionally untouched).
- Seed files, migrations, and `docs/PLATFORM_BOOTSTRAP.md` left untouched (out of scope per issue).

## Gates

- `npm run test`: 37 files / 379 tests, all pass (includes the new KID-239 test).
- `npm run lint`: clean of errors (pre-existing `<img>` warnings only).
- `npm run build`: success.

## Production evidence (after deploy, all rendered login hosts)

| Host | HTTP | /login forbidden-string matches |
|---|---|---|
| `https://kiddyapp.net/login` | 200 | 0 |
| `https://sunshine.kiddyapp.net/login` | 200 | 0 |
| `https://kiddy-one.vercel.app/login` (legacy) | 200 | 0 |

Strings checked: `sunshinedaycare`, `kiddy-admin`, `kiddy-parent`, `Demo:`.
Register link verified still present on all three. Raw fetch log: `evidence-curl.txt`.
Screenshot of the clean login page: `kid239-login-clean.png` (no credential material anywhere).

## KB article note

No published KB or docs article in the repo quotes the old hint line
(`git grep "Demo: admin"` returns nothing outside this issue's own evidence). Docs refresh not needed here.

Deploy was promoted via `vercel deploy --prod` head code (the push alone had not produced a new
deployment; CLI redeploy from head `06582a4` aliased all production hosts).
