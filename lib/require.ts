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

// KID-485: the caregiver's portal is the children area only (plus its own
// account settings and the notification list). Everything else is refused
// server-side: a direct URL to any other portal surface redirects into the
// children area, so hiding nav links is defense-in-depth, never the gate.
// This list is the single source of truth for the page gate (and the tests).
export const CAREGIVER_ALLOWED_PREFIXES = ["/portal/children", "/portal/account", "/portal/notifications"];

export function caregiverPathAllowed(pathname: string): boolean {
  return CAREGIVER_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

// Same session contract as requireSession(), with the caregiver URL gate
// applied. Portal pages call this instead of requireSession() so the floor
// role cannot reach hidden surfaces by typing the URL. Teachers, admins,
// owners and parents pass unchanged on every path.
export function requirePortalPage(pathname: string) {
  const session = requireSession();
  if (session.role === "caregiver" && !caregiverPathAllowed(pathname)) {
    redirect("/portal/children");
  }
  return session;
}

// KID-485: the business-write side of the same gate. Actions call this right
// after holding the session: a caregiver is read-only on center records (its
// own account actions and the classroom-scoped child status log stay open).
// Lives here next to requirePortalPage, NOT in lib/actions.ts — a "use server"
// module may only export async functions.
export function refuseCaregiver(
  me: { role: string; email?: string },
  back = "/portal/children?error=readonly"
): void {
  if (me.role !== "caregiver") return;
  console.error("KID-485 refused a caregiver business write:", me.email);
  redirect(back);
}

// KID-112: call at the top of every /child page with its own pathname.
// - no_access family links (or a withdrawn account) can never view parent pages.
// - KID-486 pickup links see ONLY the minimal /child pickup page (plus its own
//   account settings). Child detail and every section page redirect back to /child.
// - KID-486 family links are view-only: every /child section page reads fine,
//   but the messages surface (page AND nav) is gone for them — a family link
//   reaching /child/messages is redirected to /child.
// Every write action enforces the rest server-side (lib/actions.ts).
export async function requireFamilyPage(pathname: string) {
  const session = await requireSessionWithWithdrawalCheck();
  if (session.role !== "parent") return session;
  const { familyAccessForAccount } = await import("@/lib/store");
  const access = (await familyAccessForAccount(session.accountId)) ?? "parent";
  if (access === "no_access") redirect("/login?error=disabled");
  if (access === "family" && (pathname === "/child/messages" || pathname.startsWith("/child/messages/"))) {
    redirect("/child");
  }
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
  // KID-498: an account holding zero family links is an UNFINISHED ACTIVATION,
  // not a withdrawal — isAccountAccessWithdrawn no longer classifies it as
  // withdrawn (that would repeat the Sunshine "this account's access has been
  // withdrawn" lockout on a half-registered parent). A live session still
  // cannot stand in a half-built portal, so it bounces to /login with the
  // distinct state. The write itself (the self-heal from the pending invite)
  // stays at the login boundary, where the parent just proved the password.
  if (session.role === "parent") {
    const { parentAccountAccessState } = await import("@/lib/store");
    const state = await parentAccountAccessState(session.accountId);
    if (state === "activation-incomplete") redirect("/login?error=activation-incomplete");
    if (state === "no-access") redirect("/login?error=no-daycare-access");
  }
  return session;
}
