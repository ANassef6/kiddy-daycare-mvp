// KID-2450: one source of truth for media limits. Both the browser
// (components/MediaUploadForm.tsx) and the server actions import this module,
// so a client can never be tighter or looser than the boundary that enforces
// the same cap server-side.
//
// Sizing rationale:
//   * Photos are resized to <= 1280px on the longest edge and re-encoded at
//     ~80% quality with a ~400 KB target. Phone photos normally land at
//     200-400 KB, roughly a 10x drop from a 3-5 MB camera JPEG.
//   * KID-2509: video can now travel straight from the browser to private R2
//     storage, so the Worker request body no longer carries it and the old
//     request-body ceiling no longer applies. Newsfeed and event videos get a
//     30 MB / 5-minute product cap (founder-approved 2026-11-26, raised from
//     15 MB by the founder on 2026-11-27 in KID-2511). The limit is one
//     constant: raising it later needs no re-architecture.
//   * Photos still use the compressed server-action path, so the 4 MB image
//     ceiling for old clients (no compression) stays.
//   * Messages, drive documents, payment proofs and profile media keep their
//     previous limits; messages stay at 60 seconds even though the shared
//     video duration constant is now 300 seconds.

export const MAX_IMAGE_EDGE = 1280;
export const IMAGE_QUALITY = 0.8;
export const IMAGE_MIN_QUALITY = 0.55;
export const IMAGE_TARGET_BYTES = 400 * 1024;
export const MAX_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024;

export const MAX_VIDEO_DURATION_SECONDS = 300;
export const MAX_VIDEO_UPLOAD_BYTES = 30 * 1024 * 1024;

// KID-2509: messages are intentionally out of scope and stay exactly as they
// were before the direct-to-R2 video change.
export const MAX_MESSAGE_VIDEO_DURATION_SECONDS = 60;

// Existing inline-attachment ceilings stay untouched: messages 1.5 MB and
// newsfeed 2.5 MB were product limits before KID-2450. Both are below the
// 4 MB request-body ceiling.
export const MAX_MESSAGE_ATTACHMENT_BYTES = 1_500_000;
export const MAX_NEWSFEED_ATTACHMENT_BYTES = 2_500_000;
export const MAX_DRIVE_FILE_BYTES = 4 * 1024 * 1024;
// KID-2466: event attachments are photos/videos only. The photo ceiling stays
// at the newsfeed request-body boundary; video uses MAX_VIDEO_UPLOAD_BYTES on
// the direct-to-R2 path (KID-2509).
export const MAX_EVENT_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export const PHOTO_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

// Branding accepts the photo formats plus SVG (inline logos are often SVG and
// canvas re-encoding would destroy them).
export const BRANDING_MIME_EXT: Record<string, string> = {
  ...PHOTO_MIME_EXT,
  "image/svg+xml": "svg",
};

export const VIDEO_MIME_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
  "video/3gpp": "3gp",
  "video/ogg": "ogv",
};

// KID-2467: the drive is a documents-only area. These are the only types a
// new drive upload may declare (browser MIME, then re-checked against the
// stored object's HEAD Content-Type). Photos, videos and images are refused.
export const DOCUMENT_MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
};

/** File-picker hint for the drive upload form (documents only). */
export const DOCUMENT_ACCEPT = Object.values(DOCUMENT_MIME_EXT)
  .map((ext) => `.${ext}`)
  .filter((ext, index, all) => all.indexOf(ext) === index)
  .join(",");

export type MediaKind = "image" | "video" | "pdf" | "other";

export function mediaKind(mime: string | undefined | null): MediaKind {
  const type = String(mime ?? "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type === "application/pdf") return "pdf";
  return "other";
}

export function isPhotoMime(mime: string | undefined | null): boolean {
  return !!PHOTO_MIME_EXT[String(mime ?? "").toLowerCase()];
}

export function isDocumentMime(mime: string | undefined | null): boolean {
  return !!DOCUMENT_MIME_EXT[String(mime ?? "").toLowerCase()];
}

// KID-2455: message rows store only the attachment name (plus its URL), so the
// bubble decides inline image vs file chip from the name's extension. The URL
// is checked first: a legacy data URI carries the mime type directly.
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v", "3gp", "ogv"]);

// KID-2487: a private media REF is the only name a stored photo has. The last
// path segment carries its extension (newsfeed/<iid>/<uuid>.png), so callers
// can classify the post photo without a separate file-name column.
export function mediaRefName(url: string | undefined | null): string {
  return String(url ?? "").split("?")[0].split("#")[0].split("/").pop() ?? "";
}

export function attachmentKind(
  name: string | undefined | null,
  url?: string | null
): MediaKind {
  const stored = String(url ?? "");
  if (stored.startsWith("data:")) {
    return mediaKind(stored.slice(5, stored.indexOf(";") > -1 ? stored.indexOf(";") : undefined));
  }
  const ext = String(name ?? "")
    .split("?")[0]
    .split("#")[0]
    .split(".")
    .pop()
    ?.toLowerCase();
  if (!ext) return "other";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (ext === "pdf") return "pdf";
  return "other";
}

export function isBrandingMime(mime: string | undefined | null): boolean {
  return !!BRANDING_MIME_EXT[String(mime ?? "").toLowerCase()];
}

/** Longest-edge resize, never upscales. */
export function targetDimensions(
  width: number,
  height: number,
  maxEdge = MAX_IMAGE_EDGE
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1).replace(/\.0$/, "")} MB`;
}

export type FileValidation =
  | { ok: true; ext: string; kind: MediaKind }
  | { ok: false; code: "empty" | "type" | "size" };

export function validatePhotoFile(file: { type?: unknown; size?: unknown; name?: unknown }): FileValidation {
  const size = Number(file.size ?? 0);
  const type = String(file.type ?? "").toLowerCase();
  if (!(size > 0)) return { ok: false, code: "empty" };
  if (!isPhotoMime(type)) return { ok: false, code: "type" };
  if (size > MAX_PHOTO_UPLOAD_BYTES) return { ok: false, code: "size" };
  return { ok: true, ext: PHOTO_MIME_EXT[type]!, kind: "image" };
}

export function validateBrandingFile(file: { type?: unknown; size?: unknown }): FileValidation {
  const size = Number(file.size ?? 0);
  const type = String(file.type ?? "").toLowerCase();
  if (!(size > 0)) return { ok: false, code: "empty" };
  if (!isBrandingMime(type)) return { ok: false, code: "type" };
  if (size > MAX_PHOTO_UPLOAD_BYTES) return { ok: false, code: "size" };
  return { ok: true, ext: BRANDING_MIME_EXT[type]!, kind: "image" };
}

/** Image / video / PDF attachment used by the newsfeed and the drive. */
export function validateMediaAttachment(
  file: { type?: unknown; size?: unknown },
  maxBytes: number
): FileValidation {
  const size = Number(file.size ?? 0);
  const type = String(file.type ?? "").toLowerCase();
  if (!(size > 0)) return { ok: false, code: "empty" };
  const kind = mediaKind(type);
  if (kind === "other") return { ok: false, code: "type" };
  if (size > maxBytes) return { ok: false, code: "size" };
  const ext =
    kind === "image"
      ? PHOTO_MIME_EXT[type] ?? "img"
      : kind === "video"
        ? (VIDEO_MIME_EXT[type] ?? "mp4")
        : "pdf";
  return { ok: true, ext, kind };
}
