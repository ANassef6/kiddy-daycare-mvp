// KID-236: "Enter as admin" — one-click, audited operator access into any
// daycare's own portal, with no per-tenant accounts (the board's rule).
//
// Shape, in three short-lived credentials:
//
//   1. GRANT (<= 60s, single-use): minted inside `requirePlatformOperator` by
//      the /platform server action, HMAC-signed with the same session secret
//      (lib/auth.ts signToken), bound to (operator account, institute, nonce).
//      The action 302s the browser to `https://<prefix>.<apex>/operator-
//      entry?grant=...`.
//   2. CONSUMPTION (app/operator-entry/route.ts, ON the daycare host): the
//      grant is verified ON THAT HOST — institute must match the host tenant —
//      and refused on expiry, replay, wrong host, unknown host, a disabled
//      daycare, or an operator no longer on the PLATFORM_ADMIN_EMAIL
//      allowlist. A pass inserts the 'enter' audit row; the partial unique
//      index (0025) makes that insert the single-use gate.
//   3. OPERATOR-VIEW SESSION (<= 60 min): a host-only `kiddy_sess` cookie on
//      the daycare's own subdomain, carrying the platform sentinel role plus
//      the `operatorViewInstituteId` marker. Tenant resolution (lib/tenant.ts)
//      accepts it ONLY for its bound institute on its own host; every other
//      host fail-closes. The banner (components/OperatorViewBanner.tsx) marks
//      every tenant surface; Exit (app/operator-exit/route.ts) clears only
//      that cookie and returns the operator to /platform.
//
// The pure parts (mint/read/evaluate, session token) live here so the unit
// tests pin every refusal without a server. Rails this module must never
// break: no account/staff/role creation or mutation, no credentials in code —
// the grant and the view session are the only artifacts.
import crypto from "crypto";
import { signToken, verifyToken } from "./auth";
import { PLATFORM_OPERATOR_ROLE } from "./platform";
import { subdomainUrl } from "./subdomain";
import { isUniqueViolation, queryGet, queryRun, uid } from "./db";

/** The board's cap: a grant may live at most 60 seconds. */
export const OPERATOR_ENTRY_GRANT_TTL_MS = 60_000;

/** The board's cap: an operator-view session may live at most 60 minutes. */
export const OPERATOR_VIEW_SESSION_TTL_MS = 60 * 60 * 1000;

/** Cookie Max-Age twin of the view-session TTL (seconds). */
export const OPERATOR_VIEW_COOKIE_MAX_AGE_S = OPERATOR_VIEW_SESSION_TTL_MS / 1000;

export type OperatorEntryGrant = {
  kind: "operator-entry";
  operatorAccountId: string;
  operatorEmail: string;
  instituteId: string;
  nonce: string;
  exp: number;
};

/** Mint a single-use, signed entry grant. Called ONLY inside
 *  requirePlatformOperator (lib/actions.ts) — that guard is what makes a
 *  staff/parent/guest mint attempt impossible; this function itself trusts
 *  its caller the way every other action helper does. */
export function mintOperatorEntryGrant(
  operator: { accountId: string; email: string },
  instituteId: string,
  nowMs = Date.now()
): string {
  return signToken({
    kind: "operator-entry",
    operatorAccountId: operator.accountId,
    operatorEmail: String(operator.email ?? "").toLowerCase(),
    instituteId,
    nonce: crypto.randomBytes(16).toString("hex"),
    exp: nowMs + OPERATOR_ENTRY_GRANT_TTL_MS,
  });
}

/** Verify + shape-check a grant token. Tampered, foreign-kind, or incomplete
 *  tokens all read as null (fail closed) — same contract as the session
 *  reader. Expired grants still parse; the expiry decision lives in
 *  evaluateOperatorEntryGrant so tests can drive both sides of the boundary. */
export function readOperatorEntryGrant(
  token: string | null | undefined,
  _nowMs = Date.now()
): OperatorEntryGrant | null {
  const data = verifyToken(String(token ?? ""));
  if (!data || data.kind !== "operator-entry") return null;
  const operatorAccountId = typeof data.operatorAccountId === "string" ? data.operatorAccountId : "";
  const operatorEmail = typeof data.operatorEmail === "string" ? data.operatorEmail : "";
  const instituteId = typeof data.instituteId === "string" ? data.instituteId : "";
  const nonce = typeof data.nonce === "string" ? data.nonce : "";
  const exp = typeof data.exp === "number" ? data.exp : 0;
  if (!operatorAccountId || !operatorEmail || !instituteId || !nonce || !exp) return null;
  return { kind: "operator-entry", operatorAccountId, operatorEmail, instituteId, nonce, exp };
}

export type OperatorEntryRefusalReason =
  | "malformed"
  | "expired"
  | "host-mismatch"
  | "not-operator"
  | "missing-institute"
  | "disabled"
  | "replay";

export type OperatorEntryDecision = { ok: true } | { ok: false; reason: OperatorEntryRefusalReason };

/** The pure consumption decision the entry route applies. Every refusal the
 *  ticket pins is a reason here:
 *  - malformed: bad signature / wrong kind / missing fields;
 *  - expired: past the 60s window (boundary is fail-closed: exp == now refuses);
 *  - host-mismatch: the grant names another institute than this host's tenant
 *    (also covers an unknown host — nothing to match);
 *  - not-operator: the grant's operator account is gone, is no longer the
 *    platform sentinel, its email left the allowlist, or the emails disagree;
 *  - missing-institute: the host tenant's row vanished mid-flight (race);
 *  - disabled: institute.active = 0 — entry refused, the friendly path;
 *  - replay: the nonce already has an 'enter' row (single-use). */
export function evaluateOperatorEntryGrant(
  grant: OperatorEntryGrant | null,
  opts: {
    hostInstituteId: string | null;
    institute: { active?: number | string | null } | null;
    operator: { role: string; email: string } | null;
    operatorEmailAllowlisted: boolean;
    nonceAlreadyUsed: boolean;
    nowMs: number;
  }
): OperatorEntryDecision {
  if (!grant) return { ok: false, reason: "malformed" };
  if (grant.exp <= opts.nowMs) return { ok: false, reason: "expired" };
  if (!opts.hostInstituteId || opts.hostInstituteId !== grant.instituteId) {
    return { ok: false, reason: "host-mismatch" };
  }
  const operatorOk =
    !!opts.operator &&
    String(opts.operator.role) === PLATFORM_OPERATOR_ROLE &&
    !!opts.operatorEmailAllowlisted &&
    String(opts.operator.email ?? "").toLowerCase() === grant.operatorEmail.toLowerCase();
  if (!operatorOk) return { ok: false, reason: "not-operator" };
  if (!opts.institute) return { ok: false, reason: "missing-institute" };
  if (Number(opts.institute.active ?? 1) !== 1) return { ok: false, reason: "disabled" };
  if (opts.nonceAlreadyUsed) return { ok: false, reason: "replay" };
  return { ok: true };
}

/** The operator-view session value: the platform sentinel role plus the bound
 *  institute marker, capped at 60 minutes. Set as a host-only cookie on the
 *  daycare's own subdomain by the entry route — never through the regular
 *  session helpers (createSessionToken strips the marker). */
export function operatorViewSessionToken(grant: OperatorEntryGrant, nowMs = Date.now()): string {
  return signToken({
    accountId: grant.operatorAccountId,
    role: PLATFORM_OPERATOR_ROLE,
    email: grant.operatorEmail,
    emailConfirmed: true,
    operatorViewInstituteId: grant.instituteId,
    exp: nowMs + OPERATOR_VIEW_SESSION_TTL_MS,
  });
}

/** `https://<prefix>.<apex>/operator-entry?grant=...` — empty when the daycare
 *  has no prefix or the apex is not configured (the action then refuses with
 *  a friendly /platform message instead of minting a dead grant). An empty
 *  slug must also refuse: `subdomainUrl("")` would fabricate
 *  `https://.<apex>`, a host no browser can reach. */
export function operatorEntryUrl(slug: string, grant: string, proto = "https"): string {
  const trimmed = String(slug ?? "").trim();
  if (!trimmed) return "";
  const base = subdomainUrl(trimmed, proto);
  return base ? `${base}/operator-entry?grant=${encodeURIComponent(grant)}` : "";
}

/** One audit row. Returns false ONLY on the nonce's unique violation — that is
 *  the single-use gate doing its job (a replay). Every other error rethrows:
 *  an audit write must never fail silently. */
export async function recordPlatformAccess(row: {
  event: "enter" | "exit" | "refused";
  operatorAccountId?: string | null;
  operatorEmail: string;
  instituteId?: string | null;
  nonce?: string | null;
  detail?: string | null;
}): Promise<boolean> {
  try {
    await queryRun(
      `INSERT INTO platform_access_log (id, event, operator_account_id, operator_email, institute_id, nonce, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      uid(),
      row.event,
      row.operatorAccountId ?? null,
      String(row.operatorEmail ?? ""),
      row.instituteId ?? null,
      row.nonce ?? null,
      row.detail ?? null
    );
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

/** The daycare name for the viewing banner ("" when the row is gone — the
 *  banner renders without it rather than crashing the tenant surface). */
export async function instituteNameForOperatorView(instituteId: string): Promise<string> {
  const row = await queryGet("SELECT name FROM institute WHERE id = ?", instituteId);
  return row?.name ? String(row.name) : "";
}
