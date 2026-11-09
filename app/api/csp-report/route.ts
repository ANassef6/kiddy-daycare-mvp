import { NextResponse } from "next/server";
import { clientIpFrom, throttle, RATE_LIMIT_RULES } from "@/lib/rate-limit";

// KID-1178/F-03: collector for CSP violation reports. The report-only rollout
// sends browser violation JSON here (CSP `report-uri`). We keep only the
// diagnostic fields needed to judge whether the policy can be enforced —
// directive, blocked target, and the calling document/reporting page. The raw
// report is never echoed back or stored verbatim (a hostile page could stuff
// unbounded junk into user-controlled fields), and each line is capped in
// length per field.
//
// This endpoint is intentionally public: browsers post reports without user
// credentials and cannot be asked to. It is itself covered by the global
// security headers, and throttled by IP so it cannot become a write/DB
// amplification vector — reports are ONLY logged, never persisted.
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function clipped(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export async function POST(request: Request) {
  const ip = clientIpFrom(request.headers);
  const guard = await throttle("cspreport", RATE_LIMIT_RULES.cspReportIp, ip);
  if (!guard.ok) {
    // Throttle the collector BEFORE parsing, so abusive report floods cost
    // nothing but a 429.
    return NextResponse.json(
      {
        error: { code: "rate_limited", message: "Too many reports. Try again later." },
      },
      { status: 429, headers: { ...noStore, "Retry-After": String(guard.retryAfterSec) } }
    );
  }

  let report: unknown;
  try {
    report = await request.json();
  } catch {
    // Browsers send JSON, but a malformed body must never log anything.
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Body must be a CSP report." } },
      { status: 400, headers: noStore }
    );
  }

  // Only log the bounded diagnostic fields we actually triage on.
  const obj = typeof report === "object" && report !== null ? (report as Record<string, unknown>) : {};
  const body =
    typeof obj["csp-report"] === "object" && obj["csp-report"] !== null
      ? (obj["csp-report"] as Record<string, unknown>)
      : obj; // new-style report objects carry their fields at the top level
  console.log(
    JSON.stringify({
      fmt: "KID-1178/F-03 csp-violation",
      directive: clipped(body["effective-directive"], 64),
      blockedTarget: clipped(body["blocked-uri"] ?? body["blockedURL"], 256),
      document: clipped(body["document-uri"] ?? body["documentURI"], 256),
      referrer: clipped(body["referrer"], 128),
      disposition: clipped(body["disposition"], 32),
      statusCode: Number(body["status-code"] ?? 0) || undefined,
      sourceFile: clipped(body["source-file"], 256),
      line: Number(body["line-number"] ?? body["lineNumber"] ?? 0) || undefined,
    })
  );

  return new NextResponse(null, { status: 204, headers: noStore });
}

export async function GET() {
  return NextResponse.json(
    { error: { code: "method_not_allowed", message: "Use POST to file a CSP report." } },
    { status: 405, headers: noStore }
  );
}
