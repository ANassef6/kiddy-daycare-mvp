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
  getInstitute,
  familyAccessForAccount,
  parentCheckInOutAllowed,
  getCenterSchedule,
} from "@/lib/store";
import { evaluatePickupTime } from "@/lib/pickup-policy";
import { geofenceRefusalMessage, pickupRefusalMessage } from "@/lib/policy-messages";
import { evaluateGeofence, geofenceFromInstitute } from "@/lib/geofence";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

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
  // KID-2413 bug 6: policy refusals follow the account language.
  const { dict } = await i18nForAccount(session.accountId);

  const childId = (await params).id;
  const child = await getChild(childId);
  if (!child) return errorPayload("child not found", 404);

  const inFamily = await isChildInFamily(session.accountId, childId);
  if (!inFamily) return errorPayload("forbidden", 403);

  let body: { type?: string; at?: string; lat?: number; lng?: number; accuracy?: number } = {};
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
      return errorPayload(tr(dict, "policy.parentCheckInDisabled"), 403);
    }
  }

  // KID-2503: premises geofence. The phone sends its position; the server
  // computes the distance and stores it on the ledger row for audit. A
  // missing or out-of-radius position is refused, never silently accepted.
  const geofenceSettings = child.institute_id
    ? geofenceFromInstitute(await getInstitute(String(child.institute_id)))
    : null;
  const geofenceDecision = evaluateGeofence(geofenceSettings, {
    lat: body.lat,
    lng: body.lng,
    accuracy: body.accuracy,
  });
  if (!geofenceDecision.ok) {
    return errorPayload(geofenceRefusalMessage(dict, geofenceDecision), 422);
  }

  // KID-1371: the boundary matrix. An `at` body value must be a parseable
  // ISO date-time of TODAY, not in the past, inside the center's working
  // hours on an open day — otherwise the request is unprocessable (422) and
  // nothing is written. The no-`at` case records the server clock under the
  // same open-day/hours rules.
  const schedule = child.institute_id
    ? await getCenterSchedule(String(child.institute_id))
    : { week: {}, timeZone: undefined };
  const decision = evaluatePickupTime({
    type,
    now: new Date(),
    week: schedule.week,
    timeZone: schedule.timeZone,
    at: body.at ?? undefined,
  });
  if (!decision.ok) {
    return errorPayload(pickupRefusalMessage(dict, decision), 422);
  }

  await registerCheckInOut({
    childId,
    accountId: session.accountId,
    type,
    at: decision.at,
    lat: geofenceDecision.lat,
    lng: geofenceDecision.lng,
    accuracyM: geofenceDecision.accuracyM ?? null,
  });

  const summary = await childSummary(child);
  return NextResponse.json(summary);
}
