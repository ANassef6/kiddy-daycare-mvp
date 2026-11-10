import { NextRequest, NextResponse } from "next/server";
import {
  requireMobileSession,
  errorPayload,
  childSummary,
  isChildInFamily,
} from "@/lib/mobile-api";
import {
  registerCheckInOut,
  getChild,
  familyAccessForAccount,
  parentCheckInOutAllowed,
  getWorkingHours,
} from "@/lib/store";
import { evaluatePickupTime } from "@/lib/pickup-policy";

export const dynamic = "force-dynamic";

// Parent-driven check-in / check-out (today's pickup-time registration) for
// the daily loop. Mirrors the web CheckInButton (app/child/[id]/page.tsx)
// through the same store function and the same guards:
//   - KID-1329: the center's "Allow parents to check in/out" toggle, default
//     on, rejects parent accounts when it is off; the pickup role's dedicated
//     pickup-time registration stays available.
//   - KID-1371: the pickup-time boundary matrix — same-day only, past times
//     rejected, inside working hours on an open day; the body may carry a
//     validated candidate `at` (ISO date-time), otherwise the server clock is
//     recorded; re-registration updates today's entry (one per child per day).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMobileSession(req);
  if (session instanceof NextResponse) return session;

  const childId = (await params).id;
  const child = await getChild(childId);
  if (!child) return errorPayload("child not found", 404);

  const inFamily = await isChildInFamily(session.accountId, childId);
  if (!inFamily) return errorPayload("forbidden", 403);

  let body: { type?: string; at?: string } = {};
  try {
    body = await req.json();
  } catch {
    return errorPayload("Invalid JSON body.");
  }
  const type = body.type === "out" ? "out" : body.type === "in" ? "in" : null;
  if (!type) return errorPayload('type must be "in" or "out"');

  // KID-1329: the center toggle. Parent-role accounts that are NOT a pickup
  // link (parents and family links share this parent-app flow) are rejected
  // when the toggle is off; staff sessions keep their attendance controls; a
  // pickup link keeps its single-purpose registration. The institute comes
  // from the child row, so the check is exact even across the segment.
  if (session.role === "parent") {
    const access = (await familyAccessForAccount(session.accountId)) ?? "parent";
    if (access !== "pickup" && !(await parentCheckInOutAllowed(String(child.institute_id ?? "")))) {
      return errorPayload("The daycare has turned off parent check-in/out. Please contact the center staff.", 403);
    }
  }

  // KID-1371: the boundary matrix. An `at` body value must be a parseable
  // ISO date-time of TODAY, not in the past, inside the center's working
  // hours on an open day — otherwise the request is unprocessable (422) and
  // nothing is written. The no-`at` case records the server clock under the
  // same open-day/hours rules.
  const week = child.institute_id ? await getWorkingHours(String(child.institute_id)) : {};
  const decision = evaluatePickupTime({ type, now: new Date(), week, at: body.at ?? undefined });
  if (!decision.ok) {
    return errorPayload(decision.error, 422);
  }

  await registerCheckInOut({
    childId,
    accountId: session.accountId,
    type,
    at: decision.at,
  });

  const summary = await childSummary(child);
  return NextResponse.json(summary);
}
