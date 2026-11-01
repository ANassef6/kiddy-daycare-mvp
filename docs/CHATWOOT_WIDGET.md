# Chatwoot support widget: configuration and deployment runbook (KID-308)

**Status as of 2026-10-31 (KID-308).** Env names below are verified against
the KID-306 implementation head (`kid306-chatwoot-widget` @ `4ab7977`:
`components/ChatwootWidget.tsx`, mounted in `app/layout.tsx`, contract pinned
by `tests/unit/kid306-chatwoot-widget.test.tsx`). The widget code itself is
not yet merged to `master`; this runbook describes the merged-code contract
so an operator can enable it as soon as it lands, with zero code changes.

## What this gets you

A live-chat support bubble (bottom-right, Chatwoot default) on every Kiddy
web page, backed by the board's Chatwoot server. Setting two env vars turns
it on; clearing either one turns it fully off.

## Enable / disable

1. Set **both** vars (`.env.local` locally, deploy env in production):
   `NEXT_PUBLIC_CHATWOOT_BASE_URL` and `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN`.
2. Rebuild and redeploy (they are `NEXT_PUBLIC_*`, baked in at build time).
   The bubble appears bottom-right after reload.
3. To disable: empty or unset **either** var and redeploy. The widget then
   renders nothing and makes no request to the Chatwoot server, so previews
   and tenants without Chatwoot stay clean.

## Where the widget appears

Every web page: the component is mounted once at the bottom of the root
layout (`app/layout.tsx`), below `{children}`. Mobile apps get it
automatically — they are the same PWA/TWA build, not a separate codebase.

Technically: the widget loads `${BASE_URL}/packs/js/sdk.js` once via
`next/script` (`afterInteractive`) and calls `chatwootSDK.run` exactly once
per page load (guarded against dev hot-reload double-mounts).

## What a website token is

The website token identifies one Chatwoot **website inbox**. It is a public
client-side value by design — it ships to every visitor's browser — so it
needs no secrecy handling, but keep it in env, never hardcoded in code.

Create/find it in the Chatwoot dashboard: **Settings → Inboxes → Add inbox →
Website**, then copy the channel's **website token** (shown in the inbox
configuration snippet). Do NOT use a Chatwoot API key here; API keys are
private server credentials and must never appear in docs, env examples, or
chat logs.

## Known limitation: one shared inbox

All tenants and white-label subdomains share a **single platform support
inbox**. Per-tenant/per-subdomain tokens are a separate decision pending on
parent issue KID-305 — do not invent per-tenant routing around this doc.

## Deployment env checklist

| Var | Dev / QA | Production |
| --- | --------- | ---------- |
| `NEXT_PUBLIC_CHATWOOT_BASE_URL` | `http://100.71.115.5:3000` (board's Chatwoot; plain HTTP over Tailscale) | **`https://chatwoot.kiddyapp.net`** (set on Vercel production on 2026-11-01, KID-429). The operator HTTPS origin resolved the old mixed-content blocker: the board's first answer on KID-305 was the plain-HTTP Tailscale address `http://100.71.115.5:3000` (same server, one shared inbox), which browsers block as mixed content on an HTTPS page — production therefore used the HTTPS reverse-proxied origin instead, verified loading `GET /packs/js/sdk.js` → 200 with no mixed-content or CSP errors |
| `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` | Board's shared website-inbox token (single shared platform inbox, confirmed by the board) | Set by the operator in the deploy env. Never paste the production token into docs, tickets, or chat |

**Mixed-content warning:** browsers block a plain-HTTP widget script on an
HTTPS page. Dev/QA works only because those pages are served over HTTP; if
production serves HTTPS (it does), an HTTP Chatwoot origin means **no widget
at all**. This was the KID-429 production root cause (the build shipped
without either env var, and the only recorded origin was HTTP/Tailscale);
production now runs `https://chatwoot.kiddyapp.net` and the widget is
verified visible on the web app and staff portal for logged-in users
(2026-11-01).

## Tests

`tests/unit/kid306-chatwoot-widget.test.tsx` (on the KID-306 branch) — null
render unless both vars are set, the script `src`/strategy/once-only `run`
guard, and a no-hardcoded-URL-or-token scan over `app/` + `components/` with
the example-env contract.
