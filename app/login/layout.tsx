// KID-199.3r (KID-212): /login sits inside the wildcard too. An unknown
// subdomain gets the neutral error page — never a login form wearing some
// other daycare's brand. Known subdomains keep the login form, now branded
// for the host tenant (lib/theme.ts host branch). Cross-tenant sessions are
// handled by the form itself (loginAction host gate), not here — redirecting
// a signed-in account away from /login would loop.
import { redirectToNeutralOnUnknownHost } from "@/lib/tenant";
import { ensureSeededSafe } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  // KID-2406: KID-216's one-time bootstrap moved off the public root layout
  // and onto the authenticated surfaces. Login is the first app surface an
  // unmanaged deployment hits, so it keeps the operator/demo boot guarantee.
  await ensureSeededSafe();
  await redirectToNeutralOnUnknownHost();
  return <>{children}</>;
}
