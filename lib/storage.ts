// KID-1177 (F-02): server-only storage. Everything inside this module runs
// with SUPABASE_SERVICE_ROLE_KEY, so it must never be imported by a client
// component or re-exported through a public API surface (pinned by
// tests/unit/kid1177-rls-storage.test.ts).
//
// Model:
//   * kiddy-public — genuinely public assets only (daycare branding: logos
//     rendered for anonymous visitors on marketing/portal pages). Public
//     READ by design; anonymous WRITE is impossible (migration 0041 removed
//     the anonymous storage policies the old anon-key uploads relied on).
//   * kiddy-private — every sensitive object class: payment proofs,
//     contract drafts, signed contract snapshots, child/staff photos, child
//     media. Publicly addressable by nobody. Rows hold a private REF
//     ("kiddy-private:<path>"), and the server mints short-lived signed URLs
//     only in already-authorized render contexts.
//   * Legacy rows hold full https:// URLs into kiddy-public. The render
//     helpers pass any non-ref value through unchanged, and
//     scripts/migrate-sensitive-objects.ts moves those objects into the
//     private bucket and rewrites the rows as refs.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const PUBLIC_BUCKET = "kiddy-public";
export const PRIVATE_BUCKET = "kiddy-private";

export const PRIVATE_REF_PREFIX = "kiddy-private:";

export const SIGNED_URL_TTL_SECONDS = 3600;

export function storageAdminConfigured(): boolean {
  return !!(SUPABASE_URL && SERVICE_KEY);
}

let _admin: SupabaseClient | null = null;

export function getStorageAdmin(): SupabaseClient {
  if (!storageAdminConfigured()) {
    throw new Error(
      "KID-1177 storage: SUPABASE_SERVICE_ROLE_KEY/NEXT_PUBLIC_SUPABASE_URL unset — " +
        "storage writes and signed URLs need them. Server-side only by design."
    );
  }
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

/** Rows keep private objects as "kiddy-private:<path>", never as a public
 *  URL — the format itself is the gate a URL exfiltration cannot undo. */
export function privateRef(path: string): string {
  return PRIVATE_REF_PREFIX + path;
}

export function isPrivateRef(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(PRIVATE_REF_PREFIX);
}

export function privateRefPath(value: string): string {
  return value.slice(PRIVATE_REF_PREFIX.length);
}

export async function uploadPrivateObject(
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  contentType: string
): Promise<{ error: { message: string } | null; path: string }> {
  const { error } = await getStorageAdmin()
    .storage.from(PRIVATE_BUCKET)
    .upload(path, body, { contentType, upsert: false });
  return { error, path };
}

/** Public CDN URL — kiddy-public only, for branding assets. */
export async function publicUrl(path: string): Promise<string | null> {
  const { data } = getStorageAdmin().storage.from(PUBLIC_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

/** Signed URL for a stored private REF. Failure is returned loudly-ish
 *  (logged here once) so each render context decides what "missing" means. */
export async function signedUrlForRef(ref: string, ttl = SIGNED_URL_TTL_SECONDS): Promise<string | null> {
  if (!isPrivateRef(ref)) return null;
  const { data, error } = await getStorageAdmin()
    .storage.from(PRIVATE_BUCKET)
    .createSignedUrl(privateRefPath(ref), ttl);
  if (error) {
    console.error("KID-1177 signed URL failed:", error.message, "(object:", privateRefPath(ref), ")");
    return null;
  }
  return data?.signedUrl ?? null;
}

/** Batch form for lists (newsfeed/media grids): one signed-URL call
 *  instead of one per object. Legacy public URLs pass through. */
export async function signedUrlsForRefs(refs: string[], ttl = SIGNED_URL_TTL_SECONDS): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const refsPrivate = refs.filter(isPrivateRef);
  for (const ref of refs) if (!isPrivateRef(ref)) out.set(ref, ref || null);
  if (refsPrivate.length === 0) return out;
  const { data, error } = await getStorageAdmin()
    .storage.from(PRIVATE_BUCKET)
    .createSignedUrls(refsPrivate.map(privateRefPath), ttl);
  if (error || !data) {
    console.error("KID-1177 batch signed URLs failed:", String(error?.message ?? ""));
    for (const ref of refsPrivate) out.set(ref, null);
    return out;
  }
  for (let i = 0; i < refsPrivate.length; i++) {
    const signed = data[i]?.signedUrl ?? null;
    out.set(refsPrivate[i]!, signed);
  }
  return out;
}

/** Render-side resolution: legacy/public URLs (branding, pre-migration
 *  rows, seeded picsum URLs) pass through unchanged; private refs mint a
 *  short-lived signed URL. NULL/empty and unresolvable refs stay null so
 *  callers render their "no image" state — never a broken-looking asset. */
export async function storageSrcFor(
  stored: string | null | undefined,
  ttl = SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  const value = stored ? String(stored) : "";
  if (!value) return null;
  if (isPrivateRef(value)) return signedUrlForRef(value, ttl);
  return value;
}
