import { NextRequest, NextResponse } from "next/server";
import { requireMobileSession, errorPayload, childSummary } from "@/lib/mobile-api";
import { checkChildInOut, getChild } from "@/lib/store";

export const dynamic = "force-dynamic";

// Parent-driven check-in / check-out for the daily loop. Mirrors the web
// CheckInButton (app/child/[id]/page.tsx) through the same store function.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireMobileSession(req);
  if (session instanceof NextResponse) return session;

  const child = await getChild(params.id);
  if (!child) return errorPayload("child not found", 404);

  let body: { type?: string } = {};
  try {
    body = await req.json();
  } catch {
    return errorPayload("Invalid JSON body.");
  }
  const type = body.type === "out" ? "out" : body.type === "in" ? "in" : null;
  if (!type) return errorPayload('type must be "in" or "out"');

  await checkChildInOut({
    childId: params.id,
    accountId: session.accountId,
    type,
  });

  const summary = await childSummary(child);
  return NextResponse.json(summary);
}