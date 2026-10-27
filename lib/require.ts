import { sessionFromHeaders } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAccountAccessWithdrawn, runWithdrawalSweep } from "@/lib/store";
import { isPlatformOperatorRole } from "@/lib/platform";
import { isPathAllowedForPickup } from "@/lib/contact-relationship";

export function requireSession() {
  const h = headers();
  const session = sessionFromHeaders(h);
  if (!session) redirect("/login");
  return session;
}

// KID-112: call at the top of every /child page with its own pathname.
// - no_access family links (or a withdrawn account) can never view parent pages.
// - pickup links may only see the children list, child detail (pickup
//   registration), and account settings. Everything else redirects to /child.
// - parent/family links pass through (write actions enforce the rest).
export async function requireFamilyPage(pathname: string) {
  const session = await requireSessionWithWithdrawalCheck();
  if (session.role !== "parent") return session;
  const { familyAccessForAccount } = await import("@/lib/store");
  const access = (await familyAccessForAccount(session.accountId)) ?? "parent";
  if (access === "no_access") redirect("/login?error=disabled");
  if (access === "pickup" && !isPathAllowedForPickup(pathname)) redirect("/child");
  return session;
}

// KID-86 item 9: runs the last-date withdrawal sweep and blocks accounts whose
// access has been withdrawn. Called from the authenticated layout(s) so every
// protected page is guarded without making individual pages async.
export async function requireSessionWithWithdrawalCheck() {
  const session = requireSession();
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
