import { NextRequest, NextResponse } from "next/server";
import { requireMobileSession, errorPayload, childSummary, serializeReport } from "@/lib/mobile-api";
import { getChild, listContacts, newsfeedForChild, incidentsForChild } from "@/lib/store";
import { queryGet } from "@/lib/db";

export const dynamic = "force-dynamic";

// Single child: identity + room, today's check-in/out status + daily report,
// plus contacts, newsfeed and incidents — the parent's "today" view.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireMobileSession(req);
  if (session instanceof NextResponse) return session;

  const child = await getChild(params.id);
  if (!child) return errorPayload("child not found", 404);
  const roomRow = child.room_id
    ? await queryGet("SELECT name AS room_name FROM room WHERE id = ?", child.room_id)
    : undefined;

  const [summary, contacts, newsfeed, incidents] = await Promise.all([
    childSummary(child),
    listContacts(params.id),
    newsfeedForChild(params.id),
    incidentsForChild(params.id),
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