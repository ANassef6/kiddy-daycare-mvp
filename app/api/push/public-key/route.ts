import { NextResponse } from "next/server";
import { vapidPublicKey } from "@/lib/push";

// KID-480: the public VAPID key (safe to expose; it only names the sender
// that signs pushes). Empty string when push is not configured on this
// deployment so the settings card can degrade cleanly.
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  return NextResponse.json(
    { publicKey: vapidPublicKey() },
    { headers: noStore }
  );
}
