import { sessionFromHeaders } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAccountAccessWithdrawn, runWithdrawalSweep } from "@/lib/store";
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
  return session;
}
