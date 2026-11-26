import { NextRequest, NextResponse } from "next/server";
import { getAccount, readSessionFromCookie } from "@/lib/auth";
import { tenantInstituteIdForCookie } from "@/lib/tenant";
import { RATE_LIMIT_RULES, throttle } from "@/lib/rate-limit";
import {
  isUploadPurpose,
  maxUploadBytesFor,
  presignMediaUpload,
  validateUploadIntent,
  type UploadIntent,
} from "@/lib/media-upload";
import { storageProvider } from "@/lib/storage";

export const dynamic = "force-dynamic";

const ERROR_STATUS: Record<string, number> = {
  unauthorized: 401,
  forbidden: 403,
  type: 422,
  size: 422,
  purpose: 422,
  unavailable: 503,
};

function error(code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status: ERROR_STATUS[code] ?? 400 });
}

/** KID-2453: issue a short-lived R2 PUT ticket for one prepared media file.
 *  The finalizing action re-checks ownership, size and MIME before the REF
 *  reaches a row, so this endpoint cannot become a storage cap bypass. */
export async function POST(req: NextRequest) {
  const cookie = req.headers.get("cookie");
  const session = readSessionFromCookie(cookie);
  if (!session) return error("unauthorized", "Sign in to upload media.");
  const account = await getAccount(session.accountId);
  if (!account) return error("unauthorized", "Account not found.");

  if (!(await throttle("upload", RATE_LIMIT_RULES.uploadAccount, session.accountId)).ok) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many uploads. Try again shortly." } },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const instituteId = await tenantInstituteIdForCookie(cookie);
  if (!instituteId) return error("forbidden", "No daycare is selected for this upload.");
  if (!storageProvider()) return error("unavailable", "Media storage is not configured.");
  if (storageProvider() !== "r2") {
    return error("unavailable", "Direct uploads need R2; the form will use the server path.");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return error("bad_request", "Expected a JSON body.");
  }

  const purpose = body.purpose;
  if (!isUploadPurpose(purpose)) return error("purpose", "Unknown upload purpose.");
  const intent: UploadIntent = {
    purpose,
    entityType: typeof body.entityType === "string" ? body.entityType : undefined,
    entityId: typeof body.entityId === "string" ? body.entityId : undefined,
    fileName: typeof body.fileName === "string" ? body.fileName : undefined,
    contentType: String(body.contentType ?? ""),
    size: Number(body.size ?? 0),
  };
  const validation = validateUploadIntent(intent);
  if (!validation.ok) {
    return error(
      validation.code,
      validation.code === "size"
        ? `File is larger than ${maxUploadBytesFor(purpose, intent.contentType)} bytes.`
        : "Unsupported file type."
    );
  }

  const ticket = await presignMediaUpload(intent, instituteId);
  if (!ticket.ok) {
    const code = ticket.code === "size" || ticket.code === "type" ? ticket.code : "unavailable";
    return error(code, code === "size" ? "File is too large." : "Direct upload is unavailable.");
  }

  return NextResponse.json({
    uploadUrl: ticket.url,
    key: ticket.key,
    ref: ticket.ref,
    headers: ticket.headers,
    expiresIn: ticket.expiresIn,
    maxBytes: ticket.maxBytes,
  });
}
