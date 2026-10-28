import { NextResponse } from "next/server";
import { createHash, timingSafeEqual as safeEqual } from "crypto";
import { applyLinearWriteBack, type LinearWriteBackPayload } from "@/lib/enhancements";

// KID-258 A1 (KID-264): the sync write-back surface the KID-258 Linear sync
// agent (child task A2) calls. This is the ONLY route the app exposes for
// pushing Linear's view of an enhancement request back into the portal — the
// app itself never calls Linear (no app-side Linear token, decision locked on
// KID-258).
//
// CONTRACT (for A2):
//   POST /api/enhancements/write-back
//   Authorization: Bearer <KIDDY_ENHANCEMENTS_SYNC_TOKEN>   (deployment env)
//   Content-Type: application/json
//   Body: {
//     "requestId": "<enhancement_request.id>",
//     "instituteId": "<the request's daycare id>",
//     "kind": "linear_created" | "synced" | "sync_error",
//     // with kind = "linear_created":        (queued -> linear_created)
//     "linearIssueId": "LIN-123",
//     "linearIssueUrl": "https://linear.app/…/issue/…",
//     // with kind = "synced":               (linear_created -> synced)
//     "priority": "urgent" | "high" | "medium" | "low",
//     "estimate": 3,                      // Linear points (integer >= 0)
//     "dueDate": "2026-11-15",            // ISO date (YYYY-MM-DD)
//     "expectedDelivery": "2026-11-20",   // ISO date (YYYY-MM-DD)
//     // with kind = "sync_error":
//     "syncErrorDetail": "why the sync step failed"
//   }
//   200 -> { "ok": true, "request": { …EnhancementRequest } }
//   Idempotent: replaying the SAME packet returns 200 and changes nothing.
//   Only genuinely newer states move the row (regressions -> 409).
//   Errors: 400 bad packet, 401 bad/missing token, 403 tenant mismatch
//   (instituteId does not match the request's daycare — a confused or
//   replayed packet can never write across daycares), 404 unknown requestId,
//   409 state regression.
//
// Auth: bearer token against the KIDDY_ENHANCEMENTS_SYNC_TOKEN env var
// (timing-safe compare). NO default value — an unset env refuses every
// caller (fail closed), so the surface is only ever live where the
// deployment actually holds the sync secret. This is an integration route,
// NOT a browser path: server actions and client code must not link it.
export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  // Hash both to a fixed length so the raw timing-safe compare never leaks
  // token length, and never throws on unequal lengths.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return safeEqual(ha, hb);
}

function writeBackToken(): string | null {
  const v = process.env.KIDDY_ENHANCEMENTS_SYNC_TOKEN;
  // Fail closed: no env value -> nobody can call this, period.
  return v && v.length > 0 ? v : null;
}

export async function POST(req: Request) {
  const expected = writeBackToken();
  if (!expected) {
    return NextResponse.json(
      { error: { code: "sync_disabled", message: "Write-back is not configured on this deployment." } },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!timingSafeEqual(token, expected)) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Write-back token required." } },
      { status: 401 }
    );
  }

  type WriteBackBody = Record<string, unknown> & { requestId?: unknown; instituteId?: unknown; kind?: unknown };
  
  let body: WriteBackBody | null = null;
  try {
    body = (await req.json()) as WriteBackBody;
  } catch (err) {
    console.error("KID-258 write-back: malformed JSON body:", err);
    return NextResponse.json(
      { error: { code: "invalid_packet", message: "Body must be JSON." } },
      { status: 400 }
    );
  }
  // A literal JSON `null` body parses through as null: the missing-field
  // branch below refuses it, same as a malformed packet.
  const requestId = String(body?.requestId ?? "");
  const instituteId = String(body?.instituteId ?? "");
  const kind = String(body?.kind ?? "");
  if (!requestId || !instituteId || !kind) {
    return NextResponse.json(
      { error: { code: "invalid_packet", message: "requestId, instituteId and kind are required." } },
      { status: 400 }
    );
  }
  const payload: LinearWriteBackPayload = {
    kind: kind as LinearWriteBackPayload["kind"],
    linearIssueId: body?.linearIssueId !== undefined ? String(body.linearIssueId) : undefined,
    linearIssueUrl: body?.linearIssueUrl !== undefined ? String(body.linearIssueUrl) : undefined,
    priority: body?.priority !== undefined ? String(body.priority) : undefined,
    estimate: body?.estimate !== undefined && body.estimate !== null ? Number(body.estimate) : undefined,
    dueDate: body?.dueDate !== undefined ? String(body.dueDate) : undefined,
    expectedDelivery: body?.expectedDelivery !== undefined ? String(body.expectedDelivery) : undefined,
    syncErrorDetail: body?.syncErrorDetail !== undefined ? String(body.syncErrorDetail) : undefined,
  };

  try {
    const request = await applyLinearWriteBack(requestId, instituteId, payload);
    return NextResponse.json({ ok: true, request });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`KID-258 write-back: ${message}`);
    switch (message) {
      case "enhancement-not-found":
        return NextResponse.json(
          { error: { code: "not_found", message: "No such enhancement request." } },
          { status: 404 }
        );
      case "enhancement-tenant-mismatch":
        return NextResponse.json(
          { error: { code: "tenant_mismatch", message: "instituteId does not match the request's daycare." } },
          { status: 403 }
        );
      case "enhancement-priority-invalid":
      case "enhancement-estimate-invalid":
      case "enhancement-due-date-invalid":
      case "enhancement-expected-delivery-invalid":
      case "enhancement-unknown-sync-kind":
      case "enhancement-linear-fields-missing":
        return NextResponse.json(
          { error: { code: "invalid_packet", message } },
          { status: 400 }
        );
      case "enhancement-already-synced":
      case "enhancement-not-linear-created":
        return NextResponse.json(
          { error: { code: "state_regression", message } },
          { status: 409 }
        );
      default:
        return NextResponse.json(
          { error: { code: "write_back_failed", message: "Write-back failed." } },
          { status: 500 }
        );
    }
  }
}
