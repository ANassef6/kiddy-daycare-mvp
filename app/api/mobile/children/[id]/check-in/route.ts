import { NextRequest, NextResponse } from "next/server";
import { requireMobileSession, errorPayload, childSummary, isChildInFamily } from "@/lib/mobile-api";
import { checkChildInOut, getChild, familyAccessForAccount, parentCheckInOutAllowed } from "@/lib/store";

export const dynamic = "force-dynamic";

// Parent-driven check-in / check-out for the daily loop. Mirrors the web
// CheckInButton (app/child/[id]/page.tsx) through the same store function and
// the same guards (KID-1329: the center's "Allow parents to check in/out"
// toggle, default on, rejects parent accounts when it is off; the pickup
// role's dedicated pickup-time registration stays available).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMobileSession(req);
  if (session instanceof NextResponse) return session;

  const childId = (await params).id;
  const child = await getChild(childId);
  if (!child) return errorPayload("child not found", 404);

  const inFamily = await isChildInFamily(session.accountId, childId);
  if (!inFamily) return errorPayload("forbidden", 403);

  let body: { type?: string } = {};
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

  await checkChildInOut({
    childId: childId,
    accountId: session.accountId,
    type,
  });

  const summary = await childSummary(child);
  return NextResponse.json(summary);
}