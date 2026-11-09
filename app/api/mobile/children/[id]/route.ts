import { NextRequest, NextResponse } from "next/server";
import { requireMobileSession, errorPayload, childSummary, serializeReport, isChildInFamily } from "@/lib/mobile-api";
import { getChild, listContacts, newsfeedForChild, incidentsForChild, familyAccessForAccount } from "@/lib/store";
import { queryGet } from "@/lib/db";

export const dynamic = "force-dynamic";

// Single child: identity + room, today's check-in/out status + daily report
// (KID-472 item 4: `?date=YYYY-MM-DD` optionally selects a past day's report
// while today remains the default), plus contacts, newsfeed and incidents —
// the parent's day view.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMobileSession(req);
  if (session instanceof NextResponse) return session;

  const childId = (await params).id;
  const child = await getChild(childId);
  if (!child) return errorPayload("child not found", 404);

  const inFamily = await isChildInFamily(session.accountId, childId);
  if (!inFamily) return errorPayload("forbidden", 403);

  // KID-1329: a pickup link may see the child identity (name/photo shape the
  // app renders) and today's pickup time — everything else on this endpoint
  // (date-picked daily report, contacts, newsfeed, incidents) stays hidden,
  // mirroring the web child-detail branch. Still a real 200 for the app's
  // day view, but payload-degraded.
  if (session.role === "parent") {
    const access = (await familyAccessForAccount(session.accountId)) ?? "parent";
    if (access === "pickup") {
      const summary = await childSummary(child);
      return NextResponse.json({
        // childSummary embeds todayReport — dropped for pickup, along with
        // every section below (contacts/newsfeed/incidents are never fetched).
        child: summary.child,
        status: summary.status,
      });
    }
  }

  const roomRow = child.room_id
    ? await queryGet("SELECT name AS room_name FROM room WHERE id = ?", child.room_id)
    : undefined;

  const [summary, contacts, newsfeed, incidents] = await Promise.all([
    childSummary(child, req.nextUrl.searchParams.get("date") ?? undefined),
    listContacts(childId),
    newsfeedForChild(childId),
    incidentsForChild(childId),
  ]);

  return NextResponse.json({
    ...summary,
    child: { ...summary.child, room_name: roomRow?.room_name ?? null },
    contacts: contacts.map((c: any) => ({
      id: c.id,
      fullName: c.full_name,
      relationship: c.relationship,
      phone: c.phone,
      email: c.email,
      isPickup: !!c.is_pickup,
      isEmergency: !!c.is_emergency,
    })),
    newsfeed: newsfeed.map((p: any) => ({
      id: p.id,
      authorName: p.author_name,
      body: p.body,
      mediaUrl: p.media_url,
      createdAt: p.created_at,
    })),
    incidents: incidents.map((i: any) => ({
      id: i.id,
      type: i.type,
      description: i.description,
      acknowledged: !!i.acknowledged,
      createdAt: i.created_at,
    })),
  });
}
