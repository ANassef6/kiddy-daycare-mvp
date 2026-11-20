// KID-2453: Cloudflare R2 provider (S3-compatible, private bucket).
//
// Signing uses aws4fetch, a tiny SigV4 implementation that runs unchanged in
// Node and in the Cloudflare Workers runtime (KID-2452). The bucket is never
// public: downloads are short-lived presigned GETs and uploads are presigned
// PUTs minted on the server after the caller has been authorized.
//
// Env (server-only, never NEXT_PUBLIC_*):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//   R2_ENDPOINT           optional, for a custom S3 endpoint / local test rig
//   R2_PUBLIC_BASE_URL    optional, only for genuinely public branding assets

import { AwsV4Signer } from "aws4fetch";
import type { HeadResult, PrivateObjectStore, SignedPut, StorageError } from "./types";

const DEFAULT_PUT_TTL_SECONDS = 15 * 60;

/** KID-2453 delivery rule: a private object is never stored cacheable by a
 *  shared cache. The signed GET below overrides this with a browser-only
 *  `private` directive so the reader's own device may reuse it briefly. */
export const PRIVATE_OBJECT_CACHE_CONTROL = "private, max-age=0, no-store";
/** Genuinely public branding objects only. Upload paths stamp the filename
 *  with a timestamp, so the object body never changes under one key. */
export const PUBLIC_OBJECT_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Browser-cache-only response header for signed private reads. `private`
 *  keeps Cloudflare's shared edge cache and any intermediary from storing the
 *  object; R2 egress is free, so skipping shared cache costs nothing. */
export function privateSignedGetCacheControl(ttlSeconds: number): string {
  return `private, max-age=${Math.max(1, Math.floor(ttlSeconds))}`;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function r2Configured(): boolean {
  return !!(
    env("R2_ACCESS_KEY_ID") &&
    env("R2_SECRET_ACCESS_KEY") &&
    env("R2_BUCKET") &&
    (env("R2_ENDPOINT") || env("R2_ACCOUNT_ID"))
  );
}

export function r2Endpoint(): string {
  const explicit = env("R2_ENDPOINT");
  if (explicit) return explicit.replace(/\/+$/, "");
  return `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
}

export function r2Bucket(): string {
  return env("R2_BUCKET");
}

/** Optional public host for branding assets only. Children's media never
 *  uses this path. */
export function r2PublicBaseUrl(): string | null {
  const value = env("R2_PUBLIC_BASE_URL");
  return value ? value.replace(/\/+$/, "") : null;
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function r2ObjectUrl(key: string): string | null {
  if (!r2Configured()) return null;
  return `${r2Endpoint()}/${encodeURIComponent(r2Bucket())}/${encodeKey(key)}`;
}

export function r2PublicUrl(key: string): string | null {
  const base = r2PublicBaseUrl();
  if (!base) return null;
  return `${base}/${encodeKey(key)}`;
}

function signer(method: string, url: string, headers?: Record<string, string>): AwsV4Signer {
  return new AwsV4Signer({
    method,
    url,
    headers,
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
    signQuery: true,
  });
}

export async function r2SignedGet(key: string, ttlSeconds: number): Promise<string | null> {
  const objectUrl = r2ObjectUrl(key);
  if (!objectUrl) return null;
  try {
    const url = new URL(objectUrl);
    // Set the expiry BEFORE signing: the signer keeps an existing
    // X-Amz-Expires (otherwise it defaults to 24h).
    url.searchParams.set("X-Amz-Expires", String(Math.max(1, Math.floor(ttlSeconds))));
    // Signed response override: the object is delivered straight from the R2
    // bucket domain (no Worker proxy), and only the reader's browser may cache
    // it. The signature covers this parameter, so it cannot be stripped.
    url.searchParams.set("response-cache-control", privateSignedGetCacheControl(ttlSeconds));
    const signed = await signer("GET", url.toString()).sign();
    return signed.url.toString();
  } catch (err) {
    console.error("KID-2453 R2 signed GET failed:", (err as Error).message);
    return null;
  }
}

export async function r2SignedPut(
  key: string,
  contentType: string,
  ttlSeconds = DEFAULT_PUT_TTL_SECONDS
): Promise<SignedPut | null> {
  const objectUrl = r2ObjectUrl(key);
  if (!objectUrl) return null;
  const expiresIn = Math.max(60, Math.floor(ttlSeconds));
  const url = new URL(objectUrl);
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  try {
    const signed = await signer("PUT", url.toString(), {
      "content-type": contentType,
      // Signed header, so the object keeps a non-cacheable baseline metadata
      // even if a future read path forgets the response override.
      "cache-control": PRIVATE_OBJECT_CACHE_CONTROL,
    }).sign();
    return {
      url: signed.url.toString(),
      // These headers are part of the request the client must send.
      headers: {
        "Content-Type": contentType,
        "Cache-Control": PRIVATE_OBJECT_CACHE_CONTROL,
      },
      expiresIn,
    };
  } catch (err) {
    console.error("KID-2453 R2 signed PUT failed:", (err as Error).message);
    return null;
  }
}

export async function r2PutObject(
  key: string,
  body: BodyInit | Buffer,
  contentType: string,
  cacheControl: string = PRIVATE_OBJECT_CACHE_CONTROL
): Promise<StorageError | null> {
  const objectUrl = r2ObjectUrl(key);
  if (!objectUrl) return { message: "R2 is not configured" };
  try {
    const signed = await new AwsV4Signer({
      method: "PUT",
      url: objectUrl,
      headers: { "content-type": contentType, "cache-control": cacheControl },
      body: body as BodyInit,
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    }).sign();
    const res = await fetch(signed.url.toString(), {
      method: "PUT",
      headers: signed.headers,
      body: body as BodyInit,
    });
    if (!res.ok) {
      return { message: `R2 PUT ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    return null;
  } catch (err) {
    return { message: `R2 PUT failed: ${(err as Error).message}` };
  }
}

export async function r2HeadObject(key: string): Promise<HeadResult> {
  const objectUrl = r2ObjectUrl(key);
  if (!objectUrl) return null;
  try {
    const signed = await new AwsV4Signer({
      method: "HEAD",
      url: objectUrl,
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    }).sign();
    const res = await fetch(signed.url.toString(), { method: "HEAD", headers: signed.headers });
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? "0");
    return {
      size: Number.isFinite(length) ? length : 0,
      contentType: res.headers.get("content-type"),
    };
  } catch (err) {
    console.error("KID-2453 R2 HEAD failed:", (err as Error).message);
    return null;
  }
}

export async function r2DeleteObject(key: string): Promise<void> {
  const objectUrl = r2ObjectUrl(key);
  if (!objectUrl) return;
  try {
    const signed = await new AwsV4Signer({
      method: "DELETE",
      url: objectUrl,
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    }).sign();
    const res = await fetch(signed.url.toString(), { method: "DELETE", headers: signed.headers });
    if (!res.ok && res.status !== 404) {
      console.error(`KID-2453 R2 DELETE ${res.status} for ${key}`);
    }
  } catch (err) {
    console.error("KID-2453 R2 DELETE failed:", (err as Error).message);
  }
}

export const r2Store: PrivateObjectStore = {
  id: "r2",
  configured: r2Configured,
  put: r2PutObject,
  head: r2HeadObject,
  remove: r2DeleteObject,
  signedGet: r2SignedGet,
  signedPut: r2SignedPut,
};
