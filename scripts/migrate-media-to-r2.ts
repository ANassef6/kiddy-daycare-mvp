#!/usr/bin/env node
// KID-2453: move the existing (small) media library from Supabase Storage and
// data: URIs into Cloudflare R2, rewriting each row to a provider-agnostic
// private REF.
//
// Policy (matches the plan):
//   * Sensitive objects (child/staff photos, payment proofs, contracts, drive
//     files, newsfeed media, message attachments) become "r2-private:<key>".
//   * The Supabase copy is KEPT by default (dual-read fallback while staging is
//     verified). Pass --delete-source only after verification; the bucket's
//     objects are then removed best-effort.
//   * Branding stays public and is not touched.
//
// Fail-closed per object:
//   1. Read the source (Supabase private object, Supabase public URL, or a
//      data: URI). Unknown/external URLs are skipped, never guessed.
//   2. PUT to R2, then HEAD the object and compare the byte length.
//   3. Only then rewrite the row. A failed upload leaves the row untouched.
//
// Usage:
//   npx tsx scripts/migrate-media-to-r2.ts [--dry-run] [--limit=N] [--delete-source]
//
// Env:
//   KIDDY_DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
//   (optional R2_ENDPOINT for a local S3-compatible rig)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ensureSchema, queryAll, queryRun } from "../lib/db";
import {
  PRIVATE_REF_PREFIX,
  R2_PRIVATE_REF_PREFIX,
  isR2PrivateRef,
  privateRefPath,
} from "../lib/storage";
import { getStorageAdmin, PRIVATE_BUCKET, PUBLIC_BUCKET } from "../lib/storage/supabase";
import { r2Configured, r2HeadObject, r2PutObject } from "../lib/storage/r2";

type ColumnTarget = {
  table: string;
  pk: string;
  column: string;
  /** data: URIs in this column are inlined media and should be externalized. */
  dataUris?: boolean;
};

const TARGETS: ColumnTarget[] = [
  { table: "child", pk: "id", column: "photo_url" },
  { table: "staff", pk: "id", column: "photo_url" },
  { table: "child_billing", pk: "id", column: "payment_proof_url" },
  { table: "daycare_invoice", pk: "id", column: "payment_proof_url" },
  { table: "daycare_contract", pk: "institute_id", column: "signed_url" },
  { table: "daycare_contract", pk: "institute_id", column: "draft_url" },
  { table: "daycare_contract", pk: "institute_id", column: "draft_url_ar" },
  { table: "daycare_contract", pk: "institute_id", column: "draft_url_en" },
  { table: "drive_file", pk: "id", column: "url", dataUris: true },
  { table: "newsfeed_post", pk: "id", column: "media_url", dataUris: true },
  { table: "message_thread", pk: "id", column: "attachment_url", dataUris: true },
];

type Source =
  | { kind: "r2" }
  | { kind: "skip"; note: string }
  | { kind: "bytes"; key: string; body: Buffer; contentType: string; source: "storage" | "data" };

function loadDotEnv(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"+|"+$/g, "");
  }
}

function decodeDataUri(value: string): { body: Buffer; contentType: string } | null {
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(value);
  if (!m) return null;
  const contentType = m[1] || "application/octet-stream";
  const raw = m[3] ?? "";
  try {
    return {
      body: m[2] ? Buffer.from(raw, "base64") : Buffer.from(decodeURIComponent(raw), "utf8"),
      contentType,
    };
  } catch {
    return null;
  }
}

function extFor(contentType: string): string {
  const type = contentType.toLowerCase().split(";")[0]!.trim();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "application/pdf": "pdf",
    "text/html": "html",
  };
  return map[type] ?? (type.split("/")[1]?.replace(/[^a-z0-9]+/gi, "").slice(0, 8) || "bin");
}

/** Supabase object path from a public URL, if it is one of our buckets. */
function publicUrlObject(value: string): { bucket: string; path: string } | null {
  for (const bucket of [PUBLIC_BUCKET, PRIVATE_BUCKET]) {
    const needle = `/storage/v1/object/public/${bucket}/`;
    const at = value.indexOf(needle);
    if (at === -1) continue;
    const tail = value.slice(at + needle.length).split("?")[0]!;
    try {
      return { bucket, path: decodeURIComponent(tail) };
    } catch {
      return { bucket, path: tail };
    }
  }
  return null;
}

async function readSource(stored: string, target: ColumnTarget, pk: string): Promise<Source> {
  if (isR2PrivateRef(stored)) return { kind: "r2" };
  if (stored.startsWith(PRIVATE_REF_PREFIX)) {
    const objectPath = privateRefPath(stored);
    const { data, error } = await getStorageAdmin().storage.from(PRIVATE_BUCKET).download(objectPath);
    if (error || !data) return { kind: "skip", note: `supabase download failed: ${error?.message ?? "no data"}` };
    const body = Buffer.from(await (data as Blob).arrayBuffer());
    return {
      kind: "bytes",
      key: objectPath,
      body,
      contentType: (data as Blob).type || "application/octet-stream",
      source: "storage",
    };
  }
  const publicObject = publicUrlObject(stored);
  if (publicObject) {
    // A sensitive column can still point at a pre-KID-1177 kiddy-public URL;
    // those objects move too. Branding columns are not in TARGETS, so a
    // genuinely public logo is never rewritten here.
    const { data, error } = await getStorageAdmin()
      .storage.from(publicObject.bucket)
      .download(publicObject.path);
    if (error || !data) return { kind: "skip", note: `supabase download failed: ${error?.message ?? "no data"}` };
    const body = Buffer.from(await (data as Blob).arrayBuffer());
    return {
      kind: "bytes",
      key: publicObject.path,
      body,
      contentType: (data as Blob).type || "application/octet-stream",
      source: "storage",
    };
  }
  if (stored.startsWith("data:")) {
    if (!target.dataUris) return { kind: "skip", note: "data URI not in a media column" };
    const decoded = decodeDataUri(stored);
    if (!decoded) return { kind: "skip", note: "unreadable data URI" };
    const key = `legacy/${target.table}/${pk}/${crypto.randomUUID()}.${extFor(decoded.contentType)}`;
    return { kind: "bytes", key, body: decoded.body, contentType: decoded.contentType, source: "data" };
  }
  return { kind: "skip", note: "external URL / not a storage object" };
}

async function main(): Promise<number> {
  loadDotEnv();
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const deleteSource = args.has("--delete-source");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Math.max(0, Number(limitArg.split("=")[1])) : Infinity;

  if (!process.env.KIDDY_DATABASE_URL) {
    console.error("Missing KIDDY_DATABASE_URL — refusing to guess where the rows live.");
    return 1;
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase service config — cannot read the legacy objects.");
    return 1;
  }
  if (!r2Configured()) {
    console.error("Missing R2 config (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET).");
    return 1;
  }
  await ensureSchema();

  let migrated = 0;
  let skipped = 0;
  let already = 0;
  let queued = 0;
  const failures: string[] = [];

  for (const target of TARGETS) {
    if (migrated >= limit) break;
    const rows = await queryAll(`SELECT ${target.pk} AS pk, ${target.column} AS value FROM ${target.table}`);
    for (const row of rows) {
      if (migrated >= limit) break;
      const pk = String(row.pk);
      const stored = row.value == null ? "" : String(row.value).trim();
      if (!stored) continue;
      if (isR2PrivateRef(stored)) {
        already += 1;
        continue;
      }
      const source = await readSource(stored, target, pk);
      if (source.kind === "r2") {
        already += 1;
        continue;
      }
      if (source.kind === "skip") {
        skipped += 1;
        if (source.note !== "external URL / not a storage object" && source.note !== "public branding asset") {
          console.warn(`skip ${target.table}.${target.column} ${pk}: ${source.note}`);
        }
        continue;
      }
      queued += 1;
      if (dryRun) {
        console.log(`would migrate ${target.table}.${target.column} ${pk} → ${R2_PRIVATE_REF_PREFIX}${source.key} (${source.body.length} bytes)`);
        continue;
      }
      const putError = await r2PutObject(source.key, source.body, source.contentType);
      if (putError) {
        failures.push(`${target.table}.${target.column} ${pk}: ${putError.message}`);
        continue;
      }
      const head = await r2HeadObject(source.key);
      if (!head || head.size !== source.body.length) {
        failures.push(
          `${target.table}.${target.column} ${pk}: R2 verification failed (expected ${source.body.length}, got ${head?.size ?? "missing"})`
        );
        continue;
      }
      const ref = `${R2_PRIVATE_REF_PREFIX}${source.key}`;
      await queryRun(`UPDATE ${target.table} SET ${target.column} = ? WHERE ${target.pk} = ?`, ref, pk);
      migrated += 1;

      if (deleteSource && source.source === "storage" && stored.startsWith(PRIVATE_REF_PREFIX)) {
        const { error } = await getStorageAdmin().storage.from(PRIVATE_BUCKET).remove([source.key]);
        if (error) console.warn(`source cleanup failed ${target.table} ${pk}: ${error.message}`);
      }
    }
  }

  console.log(
    `KID-2453 media migration: migrated=${migrated} queued=${queued} already=${already} skipped=${skipped} failures=${failures.length}${dryRun ? " (dry run)" : ""}`
  );
  for (const failure of failures) console.error(`FAILED ${failure}`);
  return failures.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("KID-2453 media migration crashed:", err);
    process.exit(1);
  });
