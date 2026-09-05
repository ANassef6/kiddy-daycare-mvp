// Mobile API helpers: an HTTP session for the mobile client, reusing the web's
// signed session tokens (lib/auth.ts) so the app and web share one identity.
import { NextRequest, NextResponse } from "next/server";
import { verifyToken, getAccount } from "./auth";
import type { Row } from "./db";
import { getFirstInstitute, brandingFromInstitute, type Branding } from "./theme";
import { familiesForAccount, getChild, todayStatus, reportFor } from "./store";

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

// ---- response shaping for the mobile client ----

export function serializeChildWithRoom(child: Row): Row {
  return { ...child, room_name: child.room_name ?? null };
}

export async function childSummary(child: Row): Promise<Row> {
  const status = await todayStatus(child.id as string);
  const today = new Date().toISOString().slice(0, 10);
  const report = await reportFor(child.id as string, today);
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

export async function brandingPayload(): Promise<Branding> {
  const institute = await getFirstInstitute();
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