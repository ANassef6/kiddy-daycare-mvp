import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSessionFromCookieValue } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { isPushSubscriptionInput, removePushSubscription, savePushSubscription } from "@/lib/push";
import { ensureDefaultPushPrefs } from "@/lib/store";

// KID-480: store (or drop) the calling browser's web push subscription for
// the signed-in account. The endpoint is UNIQUE (migration 0032): re-pointing
// an existing browser keeps one row per device; disabling an activity stays
// in notification_pref, so subscribing here only fills opt-in gaps.
// KID-487: role-agnostic — staff accounts subscribe the same way and the
// default push pref rows follow the RECEIVING surface (portal activities for
// staff roles, parent activities for parents).
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
type SessionLike = { accountId: string; role?: string } | null;

function session(): SessionLike {
  return readSessionFromCookieValue(cookies().get("kiddy_sess")?.value ?? null) as SessionLike;
}

export async function POST(request: Request) {
  const s = session();
  if (!s?.accountId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to save a push subscription." } },
      { status: 401, headers: noStore }
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Body must be a JSON object." } },
      { status: 400, headers: noStore }
    );
  }
  const sub = body as { endpoint?: unknown; keys?: unknown };
  const shaped = sub && typeof sub.keys === "object" ? { endpoint: sub.endpoint, keys: sub.keys } : body;
  if (!isPushSubscriptionInput(shaped)) {
    return NextResponse.json(
      { error: { code: "invalid_subscription", message: "Missing endpoint or encryption keys." } },
      { status: 400, headers: noStore }
    );
  }
  try {
    await ensureSchema();
    await savePushSubscription(String(s.accountId), shaped, request.headers.get("user-agent") ?? undefined);
    const { isStaffRole } = await import("@/lib/push");
    const { PARENT_NOTIFICATION_ACTIVITIES, NOTIFICATION_ACTIVITIES } = await import("@/lib/store");
    await ensureDefaultPushPrefs(
      String(s.accountId),
      isStaffRole(s.role) ? (NOTIFICATION_ACTIVITIES as unknown as readonly string[]) : PARENT_NOTIFICATION_ACTIVITIES
    );
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (err) {
    console.error("KID-480 push subscribe failed:", err);
    return NextResponse.json(
      { error: { code: "subscribe_failed", message: "Could not save the push subscription." } },
      { status: 502, headers: noStore }
    );
  }
}

export async function DELETE(request: Request) {
  const s = session();
  if (!s?.accountId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to remove a push subscription." } },
      { status: 401, headers: noStore }
    );
  }
  try {
    const body = (await request.json()) as { endpoint?: unknown };
    if (typeof body?.endpoint === "string" && body.endpoint) {
      await removePushSubscription(String(s.accountId), body.endpoint);
    }
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (err) {
    console.error("KID-480 push unsubscribe failed:", err);
    return NextResponse.json(
      { error: { code: "unsubscribe_failed", message: "Could not remove the push subscription." } },
      { status: 502, headers: noStore }
    );
  }
}
