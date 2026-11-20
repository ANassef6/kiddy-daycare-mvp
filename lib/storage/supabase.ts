// KID-1177 / KID-2453: Supabase Storage provider. This is the legacy media
// home and stays available as the dual-read fallback while rows are migrated
// to R2. New writes prefer R2 when it is configured (lib/storage.ts decides).

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { StorageError } from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const PUBLIC_BUCKET = "kiddy-public";
export const PRIVATE_BUCKET = "kiddy-private";

export function supabaseStorageConfigured(): boolean {
  return !!(SUPABASE_URL && SERVICE_KEY);
}

let _admin: SupabaseClient | null = null;

export function getStorageAdmin(): SupabaseClient {
  if (!supabaseStorageConfigured()) {
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

export async function supabasePutPrivate(
  path: string,
  body: BodyInit | Buffer,
  contentType: string
): Promise<StorageError | null> {
  const { error } = await getStorageAdmin()
    .storage.from(PRIVATE_BUCKET)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upload(path, body as any, { contentType, upsert: false });
  return error ? { message: error.message } : null;
}

export async function supabaseSignedGet(path: string, ttlSeconds: number): Promise<string | null> {
  const { data, error } = await getStorageAdmin()
    .storage.from(PRIVATE_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error) {
    console.error("KID-1177 signed URL failed:", error.message, "(object:", path, ")");
    return null;
  }
  return data?.signedUrl ?? null;
}

export async function supabaseSignedGetBatch(
  paths: string[],
  ttlSeconds: number
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (paths.length === 0) return out;
  const { data, error } = await getStorageAdmin()
    .storage.from(PRIVATE_BUCKET)
    .createSignedUrls(paths, ttlSeconds);
  if (error || !data) {
    console.error("KID-1177 batch signed URLs failed:", String(error?.message ?? ""));
    for (const path of paths) out.set(path, null);
    return out;
  }
  for (let i = 0; i < paths.length; i++) {
    out.set(paths[i]!, data[i]?.signedUrl ?? null);
  }
  return out;
}

/** Public CDN URL — kiddy-public only, for branding assets. */
export async function supabasePublicUrl(path: string): Promise<string | null> {
  const { data } = getStorageAdmin().storage.from(PUBLIC_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

export async function supabasePutPublic(
  path: string,
  body: BodyInit | Buffer,
  contentType: string
): Promise<string | null> {
  const { error } = await getStorageAdmin()
    .storage.from(PUBLIC_BUCKET)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upload(path, body as any, { contentType, upsert: true });
  if (error) {
    console.error("KID-2433 public branding upload failed:", error.message);
    return null;
  }
  return supabasePublicUrl(path);
}

export async function supabaseDownload(path: string): Promise<{ data: Blob | null; error: StorageError | null }> {
  const { data, error } = await getStorageAdmin().storage.from(PRIVATE_BUCKET).download(path);
  return { data: data as Blob | null, error: error ? { message: error.message } : null };
}
