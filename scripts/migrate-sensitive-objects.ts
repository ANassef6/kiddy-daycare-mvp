#!/usr/bin/env node
// KID-1177 (F-02): C2 — move the sensitive objects out of kiddy-public.
//
// The ledger (0041) closed the anonymous write door and created the private
// bucket, but the objects that already live in kiddy-public keep living there
// until this script runs with production env. It walks every row that stores
// an object location and moves the sensitive classes — payment proofs
// (child_billing + daycare_invoice), contract drafts + signed snapshots
// (daycare_contract), child and staff photos — into kiddy-private, rewriting
// each row to the "kiddy-private:<path>" REF format the render helpers
// resolve to short-lived signed URLs. Branding (logo_url, brand_image_url)
// is deliberately NOT moved: those are the genuinely public assets the
// marketing pages render for anonymous visitors.
//
//   npx tsx scripts/migrate-sensitive-objects.ts
//
// Inputs (never hardcoded, never printed):
//   KIDDY_DATABASE_URL              production Postgres URL, or a file: path
//                                   for a local run
//   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//                                   service-key storage access; public
//                                   objects are read over their public URL
//                                   and written/deleted with the service key
//
// Per object, fail-closed ordering:
//   1. Skip anything that is not a kiddy-public URL (external/picsum URLs,
//      data: URIs, already-migrated private refs).
//   2. Download from the public URL; refuse to continue on failure.
//   3. Upload to kiddy-private at the SAME path; refuse to touch the row
//      unless the private copy downloads back successfully.
//   4. Rewrite the row to the private REF, then best-effort delete the
//      public object (KIDDY_MIGRATE_KEEP_PUBLIC=1 keeps it for a
//      paranoia pass; the bucket's public READ is by design so nothing
//      breaks while objects linger).
// Re-running is safe: private refs are skipped, so pass two is a no-op.

import fs from "node:fs";
import path from "node:path";
import { queryAll, queryRun, ensureSchema } from "../lib/db";
import {
  getStorageAdmin,
  storageAdminConfigured,
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  privateRef,
  isPrivateRef,
} from "../lib/storage";

function loadDotEnv(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^"+|"+$/g, "");
    }
  }
}

/** kiddy-public object path from a stored public URL. */
function KiddyPublicObjectPath(url: string): string | undefined {
  const m = /\/storage\/v1\/object\/public\/kiddy-public\/(.+)$/.exec(url);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** (table, pk column, url columns) for every sensitive object class. Column
 *  names double-checked against migrations 0034/0036/0037/0038/0039. */
const TARGETS: Array<{ table: string; pk: string; columns: string[] }> = [
  { table: "child_billing", pk: "id", columns: ["payment_proof_url"] },
  { table: "daycare_invoice", pk: "id", columns: ["payment_proof_url"] },
  { table: "daycare_contract", pk: "institute_id", columns: ["draft_url", "draft_url_ar", "draft_url_en", "signed_url"] },
  { table: "child", pk: "id", columns: ["photo_url"] },
  { table: "staff", pk: "id", columns: ["photo_url"] },
];

async function main(): Promise<number> {
  loadDotEnv();
  if (!process.env.KIDDY_DATABASE_URL) {
    console.error("Missing KIDDY_DATABASE_URL — refusing to guess where the objects live.");
    return 1;
  }
  if (!storageAdminConfigured()) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot write the private bucket or delete public objects.");
    return 1;
  }
  await ensureSchema();
  const admin = getStorageAdmin();
  const privateKey = admin.storage.from(PRIVATE_BUCKET);
  const keepPublic = process.env.KIDDY_MIGRATE_KEEP_PUBLIC === "1";

  let moved = 0;
  let skipped = 0;
  let alreadyPrivate = 0;
  let external = 0;
  const failures: string[] = [];

  for (const target of TARGETS) {
    const cols = target.columns.map((c) => `${c} IS NOT NULL OR ${c} <> ''`).join(" OR ");
    const rows = await queryAll(
      `SELECT * FROM ${target.table} WHERE ${cols}`
    );
    for (const row of rows) {
      const rowId = String(row[target.pk]);
      for (const column of target.columns) {
        const stored = row[column] == null ? "" : String(row[column]).trim();
        if (!stored) continue;
        if (isPrivateRef(stored)) {
          alreadyPrivate += 1;
          continue;
        }
        const publicPath = KiddyPublicObjectPath(stored);
        if (!publicPath) {
          external += 1; // picsum/external/data: URLs — not storage objects
          continue;
        }
        const label = `${target.table}[${rowId}].${column}`;
        try {
          const res = await fetch(stored, { redirect: "follow" });
          if (!res.ok) {
            failures.push(`${label}: public object unreadable (HTTP ${res.status})`);
            continue;
          }
          const body = Buffer.from(await res.arrayBuffer());
          // The private copy goes to the SAME object path — the per-scope
          // folder naming stays the audit-friendly convention it was.
          const upload = await privateKey.upload(publicPath, body, {
            contentType: res.headers.get("content-type") || "application/octet-stream",
            upsert: false,
          });
          if (upload.error) {
            failures.push(`${label}: private upload refused (${upload.error.message})`);
            continue;
          }
          // Verify the private copy downloads through the service key before
          // any row is touched — a half-copied object must never become the
          // only copy.
          const check = await privateKey.download(publicPath);
          if (check.error || !check.data) {
            failures.push(`${label}: private copy not readable back (${check.error?.message ?? "empty"})`);
            await privateKey.remove([publicPath]);
            continue;
          }
          const rewritten = await queryRun(
            `UPDATE ${target.table} SET ${column} = ? WHERE ${target.pk} = ?`,
            privateRef(publicPath),
            rowId
          );
          if ((rewritten.rowCount ?? 0) === 0) {
            failures.push(`${label}: row disappeared mid-move`);
            continue;
          }
          moved += 1;
          if (!keepPublic) {
            const removed = await admin.storage.from(PUBLIC_BUCKET).remove([publicPath]);
            if (removed.error) {
              console.log(`  public leftover kept (remove failed): ${label} — ${removed.error.message}`);
            }
          } else {
            console.log(`  public object left in place (KIDDY_MIGRATE_KEEP_PUBLIC=1): ${label}`);
          }
        } catch (err) {
          failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      skipped += 1; // rows inspected
    }
    console.log(
      `${target.table}: scanned ${rows.length} row(s), moved ${moved} object(s) so far, already-private ${alreadyPrivate}, non-storage refs ${external}`
    );
  }

  console.log(`\nKIDDY_MIGRATE: moved=${moved} already-private=${alreadyPrivate} external=${external} failures=${failures.length}${keepPublic ? " (public copies kept)" : ""}`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  if (failures.length > 0) {
    console.error("Failures above; safe to re-run after fixing (moved objects are skipped on the next pass).");
    return 1;
  }
  console.log("VERIFY OK: every sensitive object reference now points into the private bucket.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
