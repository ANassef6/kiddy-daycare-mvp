// KID-1177 / KID-2453: server-only storage facade.
//
// Everything inside this module runs with server credentials, so it must never
// be imported by a client component or re-exported through a public API
// surface (pinned by tests/unit/kid1177-rls-storage.test.ts).
//
// Model:
//   * kiddy-public — genuinely public assets only (daycare branding). Public
//     READ by design.
//   * private objects — every sensitive object class: payment proofs,
//     contract drafts, signed contract snapshots, child/staff photos, child
//     media. Publicly addressable by nobody. Rows hold a private REF and the
//     server mints short-lived signed URLs only in already-authorized render
//     contexts.
//
// KID-2453 adds Cloudflare R2 as the preferred provider behind the same
// facade. During the migration window both providers are readable:
//   * "r2-private:<key>"   — object in R2 (new writes when R2 is configured)
//   * "kiddy-private:<path>" — legacy Supabase Storage object
// Reads prefer the ref's own provider and fall back to Supabase when an R2
// object is not there yet, so a half-migrated library never shows breakage.

import {
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  getStorageAdmin,
  supabaseDownload,
  supabasePutPrivate,
  supabasePutPublic,
  supabasePublicUrl,
  supabaseSignedGet,
  supabaseSignedGetBatch,
  supabaseStorageConfigured,
} from "./storage/supabase";
import {
  PUBLIC_OBJECT_CACHE_CONTROL,
  r2Configured,
  r2DeleteObject,
  r2HeadObject,
  r2PublicUrl,
  r2PutObject,
  r2SignedGet,
  r2SignedPut,
} from "./storage/r2";
import type { HeadResult, SignedPut, StorageProviderId } from "./storage/types";

export { PUBLIC_BUCKET, PRIVATE_BUCKET, getStorageAdmin };
export { r2PublicUrl, r2Configured };

// ---- REF format -----------------------------------------------------------

/** Legacy Supabase private REF. Kept for rows written before KID-2453. */
export const PRIVATE_REF_PREFIX = "kiddy-private:";
/** New private objects live in R2. */
export const R2_PRIVATE_REF_PREFIX = "r2-private:";
/** Public branding objects in R2 (only when a public host is configured). */
export const R2_PUBLIC_REF_PREFIX = "r2-public:";

export function r2PrivateRef(key: string): string {
  return R2_PRIVATE_REF_PREFIX + key;
}

export const SIGNED_URL_TTL_SECONDS = 3600;
export const SIGNED_UPLOAD_TTL_SECONDS = 15 * 60;

export function storageProvider(): StorageProviderId | null {
  if (r2Configured()) return "r2";
  if (supabaseStorageConfigured()) return "supabase";
  return null;
}

export function storageAdminConfigured(): boolean {
  return storageProvider() !== null;
}

export function isR2PrivateRef(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(R2_PRIVATE_REF_PREFIX);
}

export function isR2PublicRef(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(R2_PUBLIC_REF_PREFIX);
}

/** Rows keep private objects as a REF, never as a public URL. */
export function privateRef(path: string): string {
  return r2Configured() ? r2PrivateRef(path) : PRIVATE_REF_PREFIX + path;
}

export function isPrivateRef(value: unknown): boolean {
  return isR2PrivateRef(value) || (typeof value === "string" && value.startsWith(PRIVATE_REF_PREFIX));
}

export function privateRefPath(value: string): string {
  if (value.startsWith(R2_PRIVATE_REF_PREFIX)) return value.slice(R2_PRIVATE_REF_PREFIX.length);
  if (value.startsWith(PRIVATE_REF_PREFIX)) return value.slice(PRIVATE_REF_PREFIX.length);
  return value;
}

// ---- Writes ---------------------------------------------------------------

export async function uploadPrivateObject(
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  contentType: string
): Promise<{ error: { message: string } | null; path: string; ref: string | null }> {
  if (r2Configured()) {
    const error = await r2PutObject(path, body, contentType);
    if (!error) return { error: null, path, ref: r2PrivateRef(path) };
    // Fail-over to Supabase keeps uploads working if R2 has a transient
    // outage; the row records the legacy REF, which the render path still
    // resolves. The failure is logged so it is never silent.
    console.error("KID-2453 R2 upload failed, falling back to Supabase:", error.message);
  }
  if (!supabaseStorageConfigured()) {
    return { error: { message: "No storage provider is configured" }, path, ref: null };
  }
  const error = await supabasePutPrivate(path, body, contentType);
  return {
    error,
    path,
    ref: error ? null : PRIVATE_REF_PREFIX + path,
  };
}

/** Branding assets are genuinely public. Returns a durable URL, or null when
 *  no public storage is configured. */
export async function uploadPublicObject(
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  contentType: string
): Promise<string | null> {
  const publicBase = r2PublicUrl(path);
  if (r2Configured() && publicBase) {
    // Branding-only key: safe to cache at the shared edge with a long TTL.
    const error = await r2PutObject(path, body, contentType, PUBLIC_OBJECT_CACHE_CONTROL);
    if (!error) return publicBase;
    console.error("KID-2453 R2 public upload failed, falling back to Supabase:", error.message);
  }
  if (!supabaseStorageConfigured()) return null;
  return supabasePutPublic(path, body, contentType);
}

/** Legacy helper kept for callers that still assemble a public URL. */
export async function publicUrl(path: string): Promise<string | null> {
  const r2Url = r2PublicUrl(path);
  if (r2Configured() && r2Url) return r2Url;
  if (!supabaseStorageConfigured()) return null;
  return supabasePublicUrl(path);
}

// ---- Reads ----------------------------------------------------------------

export async function signedUrlForRef(ref: string, ttl = SIGNED_URL_TTL_SECONDS): Promise<string | null> {
  if (isR2PrivateRef(ref)) {
    const key = privateRefPath(ref);
    const signed = await r2SignedGet(key, ttl);
    if (signed) return signed;
    // Dual-read: the object may still be in Supabase under the same key.
    if (supabaseStorageConfigured()) return supabaseSignedGet(key, ttl);
    return null;
  }
  if (isR2PublicRef(ref)) {
    return r2PublicUrl(privateRefPath(ref));
  }
  if (typeof ref === "string" && ref.startsWith(PRIVATE_REF_PREFIX)) {
    if (!supabaseStorageConfigured()) return null;
    return supabaseSignedGet(privateRefPath(ref), ttl);
  }
  return null;
}

/** Batch form for lists (newsfeed/media grids): signs R2 refs in parallel and
 *  the Supabase subset in one call. Legacy public URLs pass through. */
export async function signedUrlsForRefs(refs: string[], ttl = SIGNED_URL_TTL_SECONDS): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const r2Refs: string[] = [];
  const supabaseRefs: string[] = [];
  for (const ref of refs) {
    if (isR2PrivateRef(ref)) r2Refs.push(ref);
    else if (typeof ref === "string" && ref.startsWith(PRIVATE_REF_PREFIX)) supabaseRefs.push(ref);
    else out.set(ref, ref || null);
  }

  const r2Signed = await Promise.all(r2Refs.map(async (ref) => [ref, await signedUrlForRef(ref, ttl)] as const));
  for (const [ref, url] of r2Signed) out.set(ref, url);

  if (supabaseRefs.length > 0 && supabaseStorageConfigured()) {
    const signed = await supabaseSignedGetBatch(
      supabaseRefs.map((ref) => privateRefPath(ref)),
      ttl
    );
    for (const ref of supabaseRefs) out.set(ref, signed.get(privateRefPath(ref)) ?? null);
  } else {
    for (const ref of supabaseRefs) out.set(ref, null);
  }
  return out;
}

/** Render-side resolution: legacy/public URLs (branding, pre-migration rows,
 *  seeded picsum URLs) pass through unchanged; private refs mint a short-lived
 *  signed URL. NULL/empty and unresolvable refs stay null so callers render
 *  their "no image" state — never a broken-looking asset. */
export async function storageSrcFor(
  stored: string | null | undefined,
  ttl = SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  const value = stored ? String(stored) : "";
  if (!value) return null;
  if (isPrivateRef(value) || isR2PublicRef(value)) return signedUrlForRef(value, ttl);
  return value;
}

// ---- Presigned PUT (KID-2453) --------------------------------------------

/** Mint a short-lived direct-upload ticket. Only R2 supports this; the caller
 *  must still verify the uploaded object before recording the REF. */
export async function signedPrivateUpload(
  key: string,
  contentType: string,
  ttl = SIGNED_UPLOAD_TTL_SECONDS
): Promise<SignedPut | null> {
  if (!r2Configured()) return null;
  return r2SignedPut(key, contentType, ttl);
}

/** HEAD the uploaded object so the finalizing action can enforce the same
 *  size/type caps it would have enforced on a multipart body. */
export async function headPrivateObject(key: string): Promise<HeadResult> {
  if (r2Configured()) return r2HeadObject(key);
  return null;
}

export async function deletePrivateObject(key: string): Promise<void> {
  if (r2Configured()) await r2DeleteObject(key);
}

/** Server-side download used by the migration script (R2-agnostic source). */
export async function downloadLegacyPrivateObject(path: string): Promise<{ data: Blob | null; error: { message: string } | null }> {
  return supabaseDownload(path);
}
