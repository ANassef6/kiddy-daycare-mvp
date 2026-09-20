import { sessionFromHeaders } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAccountAccessWithdrawn, runWithdrawalSweep } from "@/lib/store";

export function requireSession() {
  const h = headers();
  const session = sessionFromHeaders(h);
  if (!session) redirect("/login");
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
