# KID-428 production evidence — Help Center is Chatwoot-backed

Production: **https://kiddyapp.net** (Vercel project `kiddy`, team account).
- PR merged to `master`: https://github.com/ANassef6/kiddy-daycare-mvp/pull/2 (squash commit `e336f128cdce8132876f0a701ef3da2590a0c6a0`)
- Production deployments serving that commit: `kiddy-lahv46ajf-kiddy2.vercel.app` (merge build, READY) and `kiddy-cbdyy0a7p-kiddy2.vercel.app` (after `CHATWOOT_BASE_URL` was pointed at the public origin, READY — verified evidence below)

Server env (production, via Vercel CLI):
- `CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net` (the board's public HTTPS Chatwoot origin; the tailnet IP `http://100.71.115.5:3000` is NOT reachable from Vercel functions — with that value the Help Center rendered its "temporarily unavailable" card, then this evidence pass re-set the origin)
- `CHATWOOT_ACCESS_TOKEN=<Chatwoot user access token>` (secret type)

Method: signed in at `https://kiddyapp.net/login` as the production platform
operator (server-action POST, session cookie in-memory only, not stored), then
fetched the help surfaces with the session cookie and captured the SSR HTML
files in this directory. The HTML files keep the full flight payload, so every
claim below is greppable in them.

## Verified claims

| Claim | Evidence (file · marker) |
| --- | --- |
| EN /portal/support renders the Chatwoot doc set | `prod-support-en.html` · `help-area-head">Public`, `help-area-head">Staff and admin`, article titles "Reset a forgotten password", "Record a payment or deposit" |
| AR (?lang=ar) renders the Arabic doc set in Arabic chrome | `prod-support-ar.html` · `help-area-head">عام`, `help-area-head">للطاقم والإدارة`, `مركز المساعدة` (×4) |
| No leftover bundled articles / no Notion links | `prod-detail.html` · zero occurrences of `app.notion.com`, `onclick=`, `javascript:`, `<script` |
| No "open the support inbox" button | `prod-support-en.html` / `prod-support-ar.html` · zero occurrences of `support-inbox` / `فتح صندوق` |
| Chatwoot's own search (?q=) ranks; results filtered to audience+language | `prod-search.html` · `help-results-count">3 articles` for `q=invoice`, results `/portal/support/97`, `/91`, `/38` (staff-visible EN only) |
| Article detail renders sanitized Chatwoot HTML | `prod-detail.html` · `/portal/support/97?lang=en` → `Generate an invoice for a child`, `help-article-related` present |
| EN/AR pairing from the sync footer | `prod-detail.html` · `data-alternate-href="/portal/support/90?lang=ar"` (the AR counterpart of article 97) |

Also verified during development against the live portal directly (96-article
reconciliation): EN groups 34 (public 5 + staff-and-admin 29), AR groups 19
(public-ar 5 + parents-ar 14), footer pairing from either direction (74 ↔ 80),
`query` search hits + local language/audience filter.

Not covered here (left to the QA gate KID-431): the parent-family surface
(/child/support) under a real parent login, and any end-to-end browser pass.
