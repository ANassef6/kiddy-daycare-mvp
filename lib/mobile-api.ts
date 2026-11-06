// Mobile API helpers: an HTTP session for the mobile client, reusing the web's
// signed session tokens (lib/auth.ts) so the app and web share one identity.
import { NextRequest, NextResponse } from "next/server";
import { verifyToken, getAccount } from "./auth";
import { queryGet, type Row } from "./db";
import { getFirstInstitute, getInstitute, brandingFromInstitute, type Branding } from "./theme";
import { familiesForAccount, getChild, todayStatus, reportFor } from "./store";
import { configuredReportDate } from "./report-dates";

export type MobileSession = {
  accountId: string;
  role: string;
  email: string;
};

const BEARER_RE = /^Bearer\s+(.+)$/i;

export function mobileSessionFromRequest(req: NextRequest): MobileSession | null {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(BEARER_RE);
  if (!m) return null;
  const data = verifyToken(decodeURIComponent(m[1]));
  if (!data || (typeof data.exp === "number" && data.exp < Date.now())) return null;
  return {
    accountId: String(data.accountId),
    role: String(data.role),
    email: String(data.email),
  };
}

export async function requireMobileSession(req: NextRequest): Promise<MobileSession | NextResponse> {
  const session = mobileSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const account = await getAccount(session.accountId);
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 401 });
  }
  return session;
}

// True when the account has an active family link to the child. This is the
// mobile API's IDOR guard: every child-scoped endpoint must verify membership
// before returning child data or acting on the child's behalf.
export async function isChildInFamily(accountId: string, childId: string): Promise<boolean> {
  const row = await queryGet(
    `SELECT 1 FROM family_member fm
     JOIN child c ON c.id = fm.child_id
     WHERE fm.account_id = ? AND fm.child_id = ? AND c.active = 1
     LIMIT 1`,
    accountId,
    childId
  );
  return row !== undefined;
}

// ---- response shaping for the mobile client ----

export function serializeChildWithRoom(child: Row): Row {
  return { ...child, room_name: child.room_name ?? null };
}

export async function childSummary(child: Row, reportDate?: string): Promise<Row> {
  const status = await todayStatus(child.id as string);
  // KID-472 item 4: `reportDate` extends the today-only payload — when an
  // endpoint passes a date (the web pages' `?date=` contract), the same
  // `todayReport` field carries that day's report (today when unset, so the
  // existing mobile behavior is byte-for-byte preserved).
  const day = configuredReportDate(reportDate, new Date().toISOString().slice(0, 10));
  const report = await reportFor(child.id as string, day);
  return {
    child: serializeChildWithRoom(child),
    status: {
      checkedIn: status.checkedIn ? status.checkedIn.recorded_at : null,
      checkedOut: status.checkedOut ? status.checkedOut.recorded_at : null,
      lastEvent: status.lastEvent
        ? { type: status.lastEvent.type, at: status.lastEvent.recorded_at }
        : null,
    },
    todayReport: report ? serializeReport(report) : null,
  };
}

export function serializeReport(report: Row): Row {
  let meal: Record<string, string> = {};
  try {
    meal = JSON.parse(String(report.meal ?? "{}")) as Record<string, string>;
  } catch {
    meal = {};
  }
  let sleep: Record<string, unknown> = {};
  if (report.sleep) {
    try {
      sleep = JSON.parse(String(report.sleep)) as Record<string, unknown>;
    } catch {
      sleep = { raw: report.sleep };
    }
  }
  return {
    id: report.id,
    childId: report.child_id,
    reportDate: report.report_date,
    summary: report.summary ?? "",
    observation: report.observation ?? "",
    mood: report.mood ?? "",
    meal,
    sleep,
    diaper: report.diaper ?? "",
    sick: !!report.sick,
    note: report.note ?? "",
    createdAt: report.created_at,
  };
}

// KID-435: the mobile home screen's brand must be the signed-in parent's OWN
// daycare, not "whichever daycare was created first" — on a multi-daycare
// deployment the first-institute pick showed one daycare's brand inside
// another daycare's app. Resolution follows the same rule the web's signed-in
// surfaces use: the account's family link (its children's institute) decides.
// Accounts with no family link (staff/legacy/ghost sessions) keep the legacy
// first-institute fallback so single-tenant deployments are unchanged.
export async function brandingPayload(accountId: string): Promise<Branding> {
  const row = await queryGet(
    `SELECT c.institute_id AS iid FROM family_member fm
     JOIN child c ON c.id = fm.child_id
     WHERE fm.account_id = ? AND c.active = 1
     ORDER BY c.created_at LIMIT 1`,
    accountId
  );
  const institute = row ? await getInstitute(String(row.iid)) : await getFirstInstitute();
  return brandingFromInstitute(institute);
}

export async function familiesPayload(accountId: string): Promise<Row[]> {
  const families = await familiesForAccount(accountId);
  const out: Row[] = [];
  for (const child of families) {
    out.push(await childSummary(child));
  }
  return out;
}

export function errorPayload(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}