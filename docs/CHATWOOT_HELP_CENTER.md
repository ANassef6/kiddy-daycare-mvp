# Chatwoot help center: configuration and deployment runbook (KID-428)

**Status as of 2026-11-01 (KID-428).** The in-app Help Center
(`/child/support` family surface, `/portal/support` staff surface) no longer
serves the bundled 96-record article file (`data/help-articles.json`, KID-388 —
deleted with this change). Articles, categories, search ranking and the
EN/AR language pairs all come live from the board's Chatwoot help-center
portal, which KID-426 verified as the single docs source.

## What this gets you

Article lists, article bodies and search results rendered inside the Kiddy
app, always identical to what Chatwoot publishes — no copies to keep in sync.
The KID-403 EN/AR control keeps its exact behavior: it picks the language of
the article set, of the chrome copy and of the page direction. Chatwoot's own
search (`?query=`) does the ranking; the app filters results to the browsing
language and to the role's category audiences.

Role gating stays app-side (Chatwoot categories map to audiences):
`public` → everyone; `parents`/`parents-ar` → parents only; `staff-and-admin`
/`staff-and-admin-ar` → staff, admins and owners.

## Server env (never in client bundles)

| Var | Meaning |
| --- | --- |
| `CHATWOOT_BASE_URL` | Chatwoot origin, e.g. `http://100.71.115.5:3000` (board instance) |
| `CHATWOOT_ACCESS_TOKEN` | Chatwoot **user access token** (admin API) — server-side secret |
| `CHATWOOT_ACCOUNT_ID` | Optional, defaults to `1` |
| `CHATWOOT_PORTAL_SLUG` | Optional, defaults to `help-center` |

Unset either required var, or a fetch failure (origin unreachable), and the
Help Center renders its "temporarily unavailable" card with the on-page
support-request path. There is deliberately no bundled fallback anymore.

The widget env (`NEXT_PUBLIC_CHATWOOT_*`, `docs/CHATWOOT_WIDGET.md`) is a
separate, client-side concern and unrelated to these vars.

## API surface used (verified against the live portal)

```
GET {BASE}/api/v1/accounts/{account}/portals/{portal}/categories?locale=<en|ar>
GET {BASE}/api/v1/accounts/{account}/portals/{portal}/articles?locale=<l>&category_slug=<s>&page=<n>
GET {BASE}/api/v1/accounts/{account}/portals/{portal}/articles/<id>
GET {BASE}/api/v1/accounts/{account}/portals/{portal}/articles?query=<q>&page=<n>
```

Auth header: `api_access_token: <CHATWOOT_ACCESS_TOKEN>`. Pages fetch with a
5-minute Next.js revalidation cache (25-articles-per-page paging is walked
until `meta.articles_count` is exhausted).

Article bodies are sanitized before rendering (`sanitizeHelpHtml`,
`lib/help-chatwoot.ts`): allowlisted tags only, attributes stripped except
safe `href`/`src`, external anchors get `rel="noopener noreferrer"`. The sync's
keyword paragraph and the Notion cross-language footer are removed from the
rendered body; the footer's opposite-language *title* is reused as the
pairing key so the detail view's EN/AR toggle jumps to the paired Chatwoot
article id (both portal languages exist as separate articles).

## Production environment

The board Chatwoot instance lives at `http://100.71.115.5:3000` (tailnet IP).
Vercel serverless functions need network reachability to that origin for the
Help Center to serve articles; if it is unreachable, the page degrades to the
unavailable card (and the widget runbook's HTTPS note applies equally here).
Set the envs with the Vercel CLI:

```
vercel env add CHATWOOT_BASE_URL production      # value from stdin
vercel env add CHATWOOT_ACCESS_TOKEN production  # secret; value from stdin
```

Then redeploy (or let the next `master` merge auto-deploy).
