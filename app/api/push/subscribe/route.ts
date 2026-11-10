import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSessionFromCookieValue } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { isPushSubscriptionInput, removePushSubscription, savePushSubscription } from "@/lib/push";
import { ensureDefaultPushPrefs } from "@/lib/store";
import { throttle, RATE_LIMIT_RULES } from "@/lib/rate-limit";

// KID-480: store (or drop) the calling browser's web push subscription for
// the signed-in account. The endpoint is UNIQUE (migration 0032): re-pointing
// an existing browser keeps one row per device; disabling an activity stays
// in notification_pref, so subscribing here only fills opt-in gaps.
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
type SessionLike = { accountId: string } | null;

async function session(): Promise<SessionLike> {
  return readSessionFromCookieValue((await cookies()).get("kiddy_sess")?.value ?? null) as SessionLike;
}

export async function POST(request: Request) {
  const s = await session();
  if (!s?.accountId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to save a push subscription." } },
      { status: 401, headers: noStore }
    );
  }
  // KID-1178/F-06: per-account budget for subscription writes (the unpersist
  // churn is bounded server-side; a looping client must not hammer the row).
  const limit = await throttle("pushSubscribe", RATE_LIMIT_RULES.pushSubscribeAccount, String(s.accountId));
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many subscription updates. Try again later." } },
      { status: 429, headers: { ...noStore, "Retry-After": String(limit.retryAfterSec) } }
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
    await ensureDefaultPushPrefs(String(s.accountId));
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
  const s = await session();
  if (!s?.accountId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to remove a push subscription." } },
      { status: 401, headers: noStore }
    );
  }
  // KID-1384: unsubscribe shares the subscribe budget — the write churn
  // (save + remove) counts against the same per-account bucket, so a looping
  // client cannot hammer the row through DELETE just because POST was safe.
  const limit = await throttle("pushSubscribe", RATE_LIMIT_RULES.pushSubscribeAccount, String(s.accountId));
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many subscription updates. Try again later." } },
      { status: 429, headers: { ...noStore, "Retry-After": String(limit.retryAfterSec) } }
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
