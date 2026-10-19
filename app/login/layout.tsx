// KID-199.3r (KID-212): /login sits inside the wildcard too. An unknown
// subdomain gets the neutral error page — never a login form wearing some
// other daycare's brand. Known subdomains keep the login form, now branded
// for the host tenant (lib/theme.ts host branch). Cross-tenant sessions are
// handled by the form itself (loginAction host gate), not here — redirecting
// a signed-in account away from /login would loop.
import { redirectToNeutralOnUnknownHost } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  await redirectToNeutralOnUnknownHost();
  return <>{children}</>;
}
