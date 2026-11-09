/** @type {import('next').NextConfig} */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// KID-1178/F-03: baseline security headers + a tailored Content Security Policy.
//
// Rollout state is environment-driven so CSP can ship report-only first and be
// switched to enforcement per deployment without a code change:
//   KIDDY_CSP_MODE=report-only (default) -> CSP delivered as
//       Content-Security-Policy-Report-Only; violations report to /api/csp-report.
//   KIDDY_CSP_MODE=enforce              -> CSP delivered as
//       Content-Security-Policy (real enforcement).
//
// The policy is tailored to what this app actually loads:
//   script-src: 'self' and the Chatwoot widget host (Script src), plus
//     'unsafe-inline' — Next.js App Router inline bootstrap scripts are
//     app-controlled, and tightening them to nonces is a follow-up step the
//     report-only phase is meant to unlock safely with real violation data.
//   style-src: 'self' 'unsafe-inline' — the root layout injects the per-tenant
//     theme tokens inline (brand colors/font vary per host, so a static hash
//     cannot cover them), and Next/React inline styles.
//   connect-src: same-origin, the Supabase project (REST + realtime WSS +
//     storage), Chatwoot (HTTP + WSS, the live-chat socket), and FCM
//     (VAPID web push service endpoint).
//   img-src: same-origin, data:/blob:, Supabase storage (branding assets) and
//     the Chatwoot host (avatars).
//   frame-ancestors 'self' + X-Frame-Options SAMEORIGIN — clickjacking.
//   object-src 'none'; base-uri 'self'; form-action 'self'.
//   worker-src 'self' blob: — the push service worker (/sw.js) plus blob
//     registrants.
// The list of third-party origins is derieved from env at build time, same as
// the app code that consumes them (NEXT_PUBLIC_* are build-time inlined too),
// so preview/production builds never ship a policy for a project they don't
// reference. HSTS is intentionally NOT set here: the hosting layer already
// serves it for the apex + tenant hosts, and duplicating it risks conflicting
// max-ages. Keeping it is a deployment invariant, not an app header.
function chatwootOrigin() {
  const raw = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.origin;
  } catch {
    return null;
  }
}

function supabaseOrigin() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy() {
  // Built from named directives — no positional bookkeeping.
  const csp = new Map([
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'"]],
    ["frame-src", ["'self'"]],
    ["frame-ancestors", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["worker-src", ["'self'", "blob:"]],
    // Violation reporting for the report-only phase (and useful afterwards).
    ["report-uri", ["/api/csp-report"]],
  ]);

  const supabase = supabaseOrigin();
  if (supabase) {
    csp.get("img-src").push(supabase, "https://*.supabase.co", "https://*.supabase.in");
    csp
      .get("connect-src")
      .push(supabase, `wss://${hostOf(supabase)}`);
    csp
      .get("connect-src")
      .push("https://*.supabase.co", "wss://*.supabase.co");
  }

  const chatwoot = chatwootOrigin();
  if (chatwoot) {
    csp.get("script-src").push(chatwoot);
    csp.get("img-src").push(chatwoot);
    csp.get("connect-src").push(chatwoot, `wss://${hostOf(chatwoot)}`); // live-chat socket
    csp.get("frame-src").push(chatwoot); // the widget runs in an iframe on its host
  }

  // Web push: the browser reaches the vendor's push service for VAPID
  // subscriptions; most of that is browser-internal, but FCM fetches from
  // service workers stay covered by connect-src.
  csp.get("connect-src").push("https://fcm.googleapis.com");

  if (process.env.NODE_ENV !== "production") {
    // Dev/HMR: Next dev overlays need eval.
    csp.get("script-src").push("'unsafe-eval'");
  }

  return [...csp.entries()].map(([dir, vals]) => [dir, vals.join(" ")].join(" ")).join("; ");
}

function hostOf(origin) {
  return origin.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function securityHeaders(mode) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
  ];
  const csp = contentSecurityPolicy();
  headers.push({
    key: mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
    value: csp,
  });
  return headers;
}

const nextConfig = {
  async rewrites() {
    return [
      {
        // KID-443 (defect 2): Digital Asset Links for the per-tenant TWA apps,
        // served as code through app/api/assetlinks + lib/twa.ts (the same
        // per-origin tenancy rule as the tenant surfaces) instead of a static
        // file each deployment can forget.
        source: "/.well-known/assetlinks.json",
        destination: "/api/assetlinks",
      },
    ];
  },
  async headers() {
    const mode =
      (process.env.KIDDY_CSP_MODE ?? "").trim().toLowerCase() === "enforce"
        ? "enforce"
        : "report-only";
    return [
      {
        source: "/:path*",
        headers: securityHeaders(mode),
      },
    ];
  },
  serverExternalPackages: ["better-sqlite3", "pg", "@supabase/supabase-js"],
  webpack: (config) => {
    // Ensure the `@/` alias resolves in every compilation context (server + client).
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": __dirname,
    };
    return config;
  },
};

export default nextConfig;
