import { sessionFromHeaders } from "@/lib/auth";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isAccountAccessWithdrawn, runWithdrawalSweep } from "@/lib/store";
import { isPlatformOperatorRole } from "@/lib/platform";
import {
  FAMILY_DENIED_PATHS,
  isPathAllowedForPickup,
} from "@/lib/contact-relationship";

// Next 15: headers() is async, so the session guard is async too — every
// caller awaits it.
export async function requireSession() {
  const h = await headers();
  const session = sessionFromHeaders(h);
  if (!session) redirect("/login");
  return session;
}

// KID-112: call at the top of every /child page with its own pathname.
// - no_access family links (or a withdrawn account) can never view parent pages.
// - pickup links may only see the children list, child detail (pickup
//   registration), and account settings. Everything else responds with a
//   real 404 (KID-1329: a late redirect can stream as HTTP 200 once the
//   loading shell has flushed, so denied slugs use next/navigation's
//   notFound() — an actual 404 status — instead).
// - parent links pass through. KID-1329: family links pass too, except the
//   messages page, which the spec hides from family accounts entirely
//   (server deny — the nav removal alone is cosmetic).
// - write actions enforce the rest.
export async function requireFamilyPage(pathname: string) {
  const session = await requireSessionWithWithdrawalCheck();
  if (session.role !== "parent") return session;
  const { familyAccessForAccount } = await import("@/lib/store");
  const access = (await familyAccessForAccount(session.accountId)) ?? "parent";
  if (access === "no_access") redirect("/login?error=disabled");
  if (access === "pickup" && !isPathAllowedForPickup(pathname)) notFound();
  if (access === "family" && FAMILY_DENIED_PATHS.has(pathname)) redirect("/child");
  return session;
}

// KID-86 item 9: runs the last-date withdrawal sweep and blocks accounts whose
// access has been withdrawn. Called from the authenticated layout(s) so every
// protected page is guarded without making individual pages async.
export async function requireSessionWithWithdrawalCheck() {
  const session = await requireSession();
  // Sweep first so any newly-reached last_date is applied before the check.
  try {
    await runWithdrawalSweep();
  } catch (err) {
    console.error("Withdrawal sweep failed:", err);
  }
  const withdrawn = await isAccountAccessWithdrawn(session.accountId);
  if (withdrawn) redirect("/login?error=withdrawn");
  // KID-199.3: a disabled daycare blocks its people at entry, in the same
  // style as the family no_access gate below. The platform operator (whose
  // internal sentinel session is not a daycare role, KID-199.4r) is exempt:
  // they are the ones who re-enable daycares.
  if (!isPlatformOperatorRole(session.role)) {
    const { isTenancyDisabled, isTenancyBillingBlocked } = await import("@/lib/store");
    if (await isTenancyDisabled(session.accountId)) {
      // KID-245: name WHY the daycare is blocked so /login can show the
      // billing message ("temporarily blocked ... contact us") instead of the
      // generic manual-disable one.
      const reason = (await isTenancyBillingBlocked(session.accountId)) ? "billing" : "manual";
      redirect(`/login?error=disabled-institute&reason=${reason}`);
    }
  }
  return session;
}
