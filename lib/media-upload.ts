// KID-2453: presigned direct uploads for sensitive media.
//
// The browser compresses the file (KID-2450), asks this module for a
// short-lived R2 PUT URL, uploads straight to R2, and then submits the server
// action with the resulting private REF. The action calls takeUploadedRef()
// before touching the database: it verifies the REF belongs to the caller's
// tenant/purpose folder, HEADs the object in R2, and re-applies the same size
// and MIME ceiling the multipart path enforced. A forged or oversized object
// is deleted and refused, so the presigned URL never becomes a cap bypass.
//
// Fallback: if direct upload is unavailable (R2 unconfigured, network error)
// the client submits the File as before and the action uploads it server-side
// through lib/storage.ts. Both paths end at the same REF model.

import {
  MAX_EVENT_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MAX_NEWSFEED_ATTACHMENT_BYTES,
  MAX_PHOTO_UPLOAD_BYTES,
  MAX_DRIVE_FILE_BYTES,
  PHOTO_MIME_EXT,
  VIDEO_MIME_EXT,
  mediaKind,
} from "./media-limits";
import { MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_TYPES } from "./payment-proof";
import { CONTRACT_TYPES, MAX_CONTRACT_BYTES } from "./contract";
import {
  deletePrivateObject,
  headPrivateObject,
  isR2PrivateRef,
  privateRefPath,
  r2PrivateRef,
  signedPrivateUpload,
} from "./storage";

export type UploadPurpose = "photo" | "proof" | "contract" | "drive" | "newsfeed" | "message" | "event";

export type UploadIntent = {
  purpose: UploadPurpose;
  entityType?: string;
  entityId?: string;
  fileName?: string;
  contentType: string;
  size: number;
};

type PurposeConfig = {
  folder: string;
  maxBytes: number;
  /** null means any non-empty content type is acceptable. */
  mimes: Record<string, string> | null;
};

const PURPOSE_CONFIG: Record<UploadPurpose, PurposeConfig> = {
  photo: { folder: "photos", maxBytes: MAX_PHOTO_UPLOAD_BYTES, mimes: PHOTO_MIME_EXT },
  proof: { folder: "payments", maxBytes: MAX_PAYMENT_PROOF_BYTES, mimes: PAYMENT_PROOF_TYPES },
  contract: { folder: "contracts", maxBytes: MAX_CONTRACT_BYTES, mimes: CONTRACT_TYPES },
  drive: {
    folder: "drive",
    // The drive intentionally accepts any file type; the byte cap is the
    // server-enforced boundary (same as KID-2450).
    maxBytes: MAX_DRIVE_FILE_BYTES,
    mimes: null,
  },
  newsfeed: {
    folder: "newsfeed",
    maxBytes: MAX_NEWSFEED_ATTACHMENT_BYTES,
    mimes: { ...PHOTO_MIME_EXT, ...VIDEO_MIME_EXT, "application/pdf": "pdf" },
  },
  message: {
    folder: "messages",
    maxBytes: MAX_MESSAGE_ATTACHMENT_BYTES,
    mimes: { ...PHOTO_MIME_EXT, ...VIDEO_MIME_EXT, "application/pdf": "pdf" },
  },
  // KID-2466: event attachments are photos and videos only (no documents).
  event: {
    folder: "events",
    maxBytes: MAX_EVENT_ATTACHMENT_BYTES,
    mimes: { ...PHOTO_MIME_EXT, ...VIDEO_MIME_EXT },
  },
};

export function uploadPurposeConfig(purpose: UploadPurpose): PurposeConfig {
  return PURPOSE_CONFIG[purpose];
}

export function isUploadPurpose(value: unknown): value is UploadPurpose {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PURPOSE_CONFIG, value);
}

export function validateUploadIntent(intent: UploadIntent): { ok: true; ext: string } | { ok: false; code: "type" | "size" | "purpose" } {
  if (!isUploadPurpose(intent.purpose)) return { ok: false, code: "purpose" };
  const config = PURPOSE_CONFIG[intent.purpose];
  const size = Number(intent.size ?? 0);
  const type = String(intent.contentType ?? "").toLowerCase();
  if (!(size > 0)) return { ok: false, code: "type" };
  if (size > config.maxBytes) return { ok: false, code: "size" };
  if (config.mimes) {
    const ext = config.mimes[type];
    if (!ext) return { ok: false, code: "type" };
    return { ok: true, ext };
  }
  // Any-type purposes (none today) still need a non-empty MIME.
  if (!type) return { ok: false, code: "type" };
  return { ok: true, ext: extFor(type) };
}

function extFor(type: string): string {
  const known = { ...PHOTO_MIME_EXT, ...VIDEO_MIME_EXT }[type];
  if (known) return known;
  if (type === "application/pdf") return "pdf";
  const tail = type.split("/")[1]?.replace(/[^a-z0-9]+/gi, "").slice(0, 8);
  return tail || "bin";
}

/** Deterministic, tenant-scoped object key for a direct upload. */
export function uploadKeyFor(
  intent: UploadIntent,
  instituteId: string,
  ext: string,
  uuid: string
): string | null {
  const config = PURPOSE_CONFIG[intent.purpose];
  if (!config) return null;
  const now = Date.now();
  switch (intent.purpose) {
    case "photo": {
      const entityType = intent.entityType === "staff" ? "staff" : "child";
      const entityId = String(intent.entityId ?? "");
      if (!entityId) return null;
      return `${config.folder}/${instituteId}/${entityType}/${entityId}/photo-${now}-${uuid}.${ext}`;
    }
    case "proof": {
      const billingId = String(intent.entityId ?? "");
      if (!billingId) return null;
      return `${config.folder}/${instituteId}/${billingId}/proof-${now}-${uuid}.${ext}`;
    }
    case "contract":
      return `${config.folder}/${instituteId}/signed-${now}-${uuid}.${ext}`;
    default:
      return `${config.folder}/${instituteId}/${uuid}.${ext}`;
  }
}

export type PresignResult =
  | {
      ok: true;
      key: string;
      ref: string;
      url: string;
      headers: Record<string, string>;
      expiresIn: number;
      maxBytes: number;
    }
  | { ok: false; code: string; maxBytes: number };

/** Mint the direct-upload ticket. Authorization (who may upload for this
 *  tenant/entity) is the caller's responsibility; the action re-checks before
 *  the REF becomes a row value. */
export async function presignMediaUpload(
  intent: UploadIntent,
  instituteId: string
): Promise<PresignResult> {
  const config = uploadPurposeConfig(intent.purpose);
  const validation = validateUploadIntent(intent);
  if (!validation.ok) {
    return { ok: false, code: validation.code, maxBytes: config.maxBytes };
  }
  const key = uploadKeyFor(intent, instituteId, validation.ext, crypto.randomUUID());
  if (!key) return { ok: false, code: "purpose", maxBytes: config.maxBytes };
  const ticket = await signedPrivateUpload(key, intent.contentType);
  if (!ticket) return { ok: false, code: "unavailable", maxBytes: config.maxBytes };
  return {
    ok: true,
    key,
    ref: r2PrivateRef(key),
    url: ticket.url,
    headers: ticket.headers,
    expiresIn: ticket.expiresIn,
    maxBytes: config.maxBytes,
  };
}

export type UploadedRefResult =
  | { ok: true; ref: string; key: string; size: number; contentType: string }
  | { ok: false; code: "missing" | "invalid" | "size" | "type" | "purpose" };

/** Finalize a direct upload: verify ownership, existence, size and MIME.
 *  Invalid objects are removed rather than left as orphaned tenant data. */
export async function takeUploadedRef(
  formData: FormData,
  opts: { purpose: UploadPurpose; instituteId: string; field?: string }
): Promise<UploadedRefResult> {
  const raw = String(formData.get(opts.field ?? "fileRef") ?? "").trim();
  if (!raw) return { ok: false, code: "missing" };
  if (!isR2PrivateRef(raw)) return { ok: false, code: "invalid" };
  const key = privateRefPath(raw);
  const config = uploadPurposeConfig(opts.purpose);
  if (!key.startsWith(`${config.folder}/${opts.instituteId}/`)) {
    return { ok: false, code: "invalid" };
  }
  const head = await headPrivateObject(key);
  if (!head) return { ok: false, code: "invalid" };
  if (head.size <= 0 || head.size > config.maxBytes) {
    await deletePrivateObject(key);
    return { ok: false, code: "size" };
  }
  if (config.mimes) {
    const type = String(head.contentType ?? "").toLowerCase().split(";")[0]!.trim();
    if (!config.mimes[type]) {
      await deletePrivateObject(key);
      return { ok: false, code: "type" };
    }
  }
  return {
    ok: true,
    ref: raw,
    key,
    size: head.size,
    contentType: String(head.contentType ?? "").split(";")[0]!.trim().toLowerCase(),
  };
}

/** Content type sanity for the client fallback path. */
export function isAllowedPurposeMime(purpose: UploadPurpose, contentType: string): boolean {
  const config = uploadPurposeConfig(purpose);
  if (!config.mimes) return !!contentType;
  return !!config.mimes[String(contentType ?? "").toLowerCase()];
}

export function mediaKindForPurpose(purpose: UploadPurpose, contentType: string) {
  void purpose;
  return mediaKind(contentType);
}
