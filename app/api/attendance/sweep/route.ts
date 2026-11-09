import crypto from "crypto";
import { NextResponse } from "next/server";
import { queryAll } from "@/lib/db";
import { runAutoCheckoutSweep } from "@/lib/store";

// KID-55 item 3 / KID-58: externally-triggerable auto check-out sweep. The
// sweep also runs automatically whenever the attendance surfaces load, but a
// scheduler/cron can hit this route to run it on its own cadence.
//
// KID-1175/F-05: this endpoint used to be fully unauthenticated — anyone who
// could reach it received the institute count, internal institute IDs,
// per-institute child/staff counts and sweep reasons. It now requires the
// shared cron secret: `Authorization: Bearer $CRON_SECRET`, compared
// timing-safely (SHA-256 digests, so the header length never leaks). An
// unauthenticated or wrong-secret request gets a uniform minimal 401 with no
// institute identifiers of any kind; when CRON_SECRET is unset the route
// fails closed (401 for everyone) and logs one setup warning. Per-institute
// details stay in server-side logs only. The mutation is unchanged and
// idempotent — it only ever writes system check-outs for people still
// checked-in 3h after closing.
//
// KID-206: with more than one centre this route must sweep EVERY institute —
// the old bare institute pick (`LIMIT 1` with no ORDER BY; see KID-205)
// pinned the first-created daycare and left centre #2+ un-swept, each with
// its own working-hours cutoff. Each centre's cutoff applies to its own rows
// inside runAutoCheckoutSweep.
//
// KID-205: the list itself is ordered deterministically
// (`ORDER BY created_at, id`) — an unordered multi-row pick lets the engine
// defer row materialization order — and each centre's result is reported in
// the server log per institute.
export const dynamic = "force-dynamic";

// KID-1175/F-05: timing-safe shared-secret check. Both sides are hashed to a
// fixed 32-byte digest first, so timingSafeEqual never throws on length
// mismatch and the presented header's length/concentration cannot be probed.
// The secret value itself is never logged.
function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const header = request.headers.get("authorization") ?? "";
  const presented = crypto.createHash("sha256").update(header).digest();
  const expected = crypto.createHash("sha256").update(`Bearer ${secret}`).digest();
  return secret !== "" && crypto.timingSafeEqual(presented, expected);
}

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false }, { status: 401 });
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    if (!process.env.CRON_SECRET) {
      console.error(
        "KID-1175/F-05 sweep: CRON_SECRET is not configured, so the attendance sweep endpoint rejects every " +
        "request. Generate a strong random secret (e.g. `openssl rand -base64 48`), set it in the deploy " +
        "environment, and configure the scheduler to send `Authorization: Bearer <CRON_SECRET>`. " +
        "See docs/DEPLOY_SECRETS.md (the value is never logged)."
      );
    } else {
      console.error("KID-1175/F-05 sweep: unauthorized sweep request rejected (no request details logged).");
    }
    return unauthorized();
  }
  const rows = await queryAll("SELECT id FROM institute ORDER BY created_at, id");
  for (const row of rows) {
    const instituteId = String(row.id);
    const result = await runAutoCheckoutSweep(instituteId);
    // KID-1175/F-05: details are server-side logging only — the HTTP response
    // stays minimal, so no institute ID, count or reason ever leaves the box.
    console.log(
      `attendance sweep: institute=${instituteId} children=${result.children.length} staff=${result.staff.length} reason=${result.reason}`
    );
  }
  if (rows.length === 0) {
    console.log("attendance sweep: no institute");
  }
  return NextResponse.json({ ok: true });
}

export const POST = GET;
