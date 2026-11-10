// KID-1384: the tenancy-disabled/billing-block login gate, factored so BOTH
// surfaces enforce it. lib/actions.ts tenancyDisabledError has served the web
// login since KID-199.3/KID-245, but "use server" modules may only export async
// functions and their helpers cannot be imported by route handlers — so the
// mobile login route (POST /api/mobile/login) silently skipped the gate and a
// billing-disabled daycare could still log in on mobile. This module carries
// the identical rule without the "use server" restriction:
//   - a platform operator is always exempt;
//   - a tenant whose every institute row is inactive is refused, with the
//     same billing-vs-manual reason split (an unpaid overdue invoice is the
//     billing signature) and the same EN/AR wording from lib/i18n;
//   - a gate failure never locks everyone out — it fails open exactly like
//     tenancyDisabledError does, and the DB-side checks are the same
//     isTenancyDisabled / isTenancyBillingBlocked pair.

import { cookies } from "next/headers";
import { isPlatformOperatorRole } from "./platform";
import { LANG_COOKIE, tenancyDisabledMessage, localeOf, type TenancyDisabledReason } from "./i18n";

export type TenancyLoginGate = { reason: TenancyDisabledReason; message: string } | null;

/** Locale for the gate message: the kiddy_lang cookie first (the same
 *  precedence every login gate uses), then the account's own preference, then
 *  English. */
async function gateLocale(accountLanguage: unknown): Promise<string> {
  try {
    const v = (await cookies()).get(LANG_COOKIE)?.value;
    if (v === "en" || v === "ar") return v;
  } catch {
    // no request scope (tests) — fall through to the account preference
  }
  return String(accountLanguage ?? "en");
}

/** The refusal for a disabled daycare, or null when the account may log in.
 *  The message never names invoices, tenants or account state beyond what the
 *  user-facing gate wording already says (KID-245 text + the platform contact
 *  inbox). */
export async function tenancyLoginGate(
  accountId: string,
  role: string,
  accountLanguage?: unknown
): Promise<TenancyLoginGate> {
  try {
    if (isPlatformOperatorRole(role)) return null;
    const { isTenancyDisabled, isTenancyBillingBlocked } = await import("./store");
    if (await isTenancyDisabled(accountId)) {
      const reason: TenancyDisabledReason = (await isTenancyBillingBlocked(accountId))
        ? "billing"
        : "manual";
      const lang = await gateLocale(accountLanguage);
      return { reason, message: tenancyDisabledMessage(reason, lang) };
    }
  } catch (err) {
    // Fail open exactly like the web gate: a broken gate must not lock every
    // account out (e.g. the active column has not been applied yet).
    console.error("KID-1384 tenancy gate failed open:", err);
  }
  return null;
}
