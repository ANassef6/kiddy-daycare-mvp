#!/usr/bin/env node
// KID-850: idempotent regeneration of the stored contract drafts.
//
// KID-746 generated the first test-daycare drafts from the WHOLE pack
// document, so every stored draft file renders ~600 characters of markdown
// (heading + prose + the ```html fence) above the contract. lib/contract-
// templates.ts now exports the fenced HTML only; this script walks every
// daycare_contract row and rebuilds the dirty drafts through the SAME
// generator the app uses (generateDaycareContractDrafts), so no legal text,
// variable fill, storage path or notification behavior is reinvented here.
//
//   npx tsx scripts/regenerate-contract-drafts.ts
//
// Inputs (never hardcoded, never printed):
//   KIDDY_DATABASE_URL      production Postgres URL, or a file: path (the
//                           local SQLite mirror) for a local run
//   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
//                           required when dirty drafts must be rewritten
//                           (uploads ride the same kiddy-public bucket);
//                           missing config aborts the rewrite per daycare
//
// SAFE to run repeatedly — the second pass is a no-op:
//   1. List every daycare_contract row pointing at draft files.
//   2. Download each draft and mark the daycare dirty only when the object
//      is NOT a clean contract file (no <!DOCTYPE html>/<html at the top, or
//      a ```html fence still inside). Clean drafts are never touched — no
//      uploads, no new files, no re-notification.
//   3. Dirty daycares: best-effort delete the wrapper objects, clear ONLY
//      the draft columns (the signed snapshot never moves) frozen before the
//      fix, and re-run the real generator. The operator notification ref
//      stays deduped by (account_id, ref) — no replay re-notify.
//   4. Verify: the new drafts download as clean HTML documents. Any failure
//      exits non-zero and is safe to re-run.

import fs from "node:fs";
import path from "node:path";
import { ensureSchema, queryAll, queryGet, queryRun } from "../lib/db";
import { generateDaycareContractDrafts, type DaycareContractRow } from "../lib/contract";

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

function draftUrls(row: Record<string, unknown>): string[] {
  return [String(row.draft_url ?? ""), String(row.draft_url_ar ?? ""), String(row.draft_url_en ?? "")].filter(
    (u) => u.startsWith("http")
  );
}

/** A clean draft starts as an HTML document and carries no markdown fence. */
function isCleanDraft(body: string): boolean {
  const t = body.trimStart();
  return (
    (t.startsWith("<!DOCTYPE html>") || t.startsWith("<!doctype html>") || t.startsWith("<html")) &&
    !body.includes("```")
  );
}

async function fetchDraft(url: string): Promise<{ ok: true; body: string } | { ok: false; note: string }> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return { ok: false, note: `HTTP ${res.status}` };
    return { ok: true, body: await res.text() };
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.message : String(err) };
  }
}

/** Object path relative to the kiddy-public bucket, from a public URL. */
function kiddyPublicObjectPath(url: string): string | undefined {
  const m = /\/storage\/v1\/object\/public\/kiddy-public\/(.+)$/.exec(url);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** The generation-time owner for the template fill — the SAME link the
 *  invoice owner mail uses (lib/billing.ts): `role = 'owner'` accounts
 *  attached to the daycare through staff. Only the name/email feed the fill;
 *  the drafts-ready notification never addresses the owner. */
async function resolveOwnerAccountId(instituteId: string): Promise<string> {
  const owner = (await queryGet(
    `SELECT a.id FROM account a
       JOIN staff s ON s.id = a.staff_id
      WHERE s.institute_id = ? AND a.role = 'owner' AND trim(a.email) <> ''
      LIMIT 1`,
    instituteId
  )) as { id: string } | undefined;
  if (owner) return String(owner.id);
  const platform = (await queryGet(
    "SELECT id FROM account WHERE role = 'platform' LIMIT 1"
  )) as { id: string } | undefined;
  if (platform) return String(platform.id);
  throw new Error("no owner or platform account found to attribute the regeneration to");
}

async function main(): Promise<number> {
  loadDotEnv();
  if (!process.env.KIDDY_DATABASE_URL) {
    console.error("Missing KIDDY_DATABASE_URL — refusing to guess where the drafts live.");
    return 1;
  }
  await ensureSchema();

  const rows = await queryAll(
    `SELECT c.institute_id, c.draft_url, c.draft_url_ar, c.draft_url_en, i.name AS daycare_name
       FROM daycare_contract c
       JOIN institute i ON i.id = c.institute_id
      WHERE c.draft_url IS NOT NULL OR c.draft_url_ar IS NOT NULL OR c.draft_url_en IS NOT NULL
      ORDER BY i.name`
  );
  console.log(`Found ${rows.length} daycare(s) with stored drafts.`);

  const dirty: Array<{ instituteId: string; daycareName: string; reasons: string[] }> = [];
  for (const row of rows) {
    const instituteId = String(row.institute_id);
    const daycareName = String(row.daycare_name ?? instituteId);
    const reasons: string[] = [];
    for (const url of draftUrls(row)) {
      const got = await fetchDraft(url);
      if (!got.ok) reasons.push(`${url} is unreachable (${got.note})`);
      else if (!isCleanDraft(got.body))
        reasons.push(
          `${url} still holds the markdown wrapper (${got.body.includes("```") ? "fence present" : "no <!DOCTYPE html> at the top"})`
        );
    }
    if (reasons.length > 0) dirty.push({ instituteId, daycareName, reasons });
    else console.log(`CLEAN, skipping: ${daycareName} (${instituteId})`);
  }

  if (dirty.length === 0) {
    console.log("VERIFY OK: every stored draft starts as clean HTML — nothing to regenerate.");
    return 0;
  }

  let failures = 0;
  for (const d of dirty) {
    console.log(`REGENERATING: ${d.daycareName} (${d.instituteId})`);
    for (const reason of d.reasons) console.log(`  reason: ${reason}`);
    try {
      const stored = (await queryGet(
        "SELECT * FROM daycare_contract WHERE institute_id = ?",
        d.instituteId
      )) as DaycareContractRow | undefined;
      if (!stored) {
        console.error("  FAILED: the row disappeared mid-run");
        failures += 1;
        continue;
      }
      // Best-effort cleanup of the wrapper objects before the row moves on.
      const oldPaths = draftUrls(stored).map(kiddyPublicObjectPath).filter((p): p is string => !!p);
      if (oldPaths.length > 0 && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        const { getSupabase } = await import("../lib/supabase");
        const { error } = await getSupabase().storage.from("kiddy-public").remove(oldPaths);
        if (error) console.log(`  old-object cleanup skipped: ${error.message}`);
      } else {
        console.log("  old-object cleanup skipped: no storage config (orphan objects left; the row moves to the new files)");
      }
      // Clear ONLY the draft columns the generator owns — the signed
      // snapshot (signed_url/…, uploaded_by_account_id) never moves here.
      await queryRun(
        `UPDATE daycare_contract
            SET draft_url = NULL, draft_url_ar = NULL, draft_url_en = NULL,
                draft_generated_at = NULL, template_version = NULL
          WHERE institute_id = ?`,
        d.instituteId
      );
      const res = await generateDaycareContractDrafts({
        instituteId: d.instituteId,
        ownerAccountId: await resolveOwnerAccountId(d.instituteId),
      });
      if (!res.ok) {
        console.error(`  FAILED: ${res.reason ?? "unknown"} — this daycare keeps its wrapper drafts; re-run after fixing the cause.`);
        failures += 1;
        continue;
      }
      const after = (await queryGet(
        "SELECT draft_url_ar, draft_url_en FROM daycare_contract WHERE institute_id = ?",
        d.instituteId
      )) as Record<string, unknown> | undefined;
      let verified = true;
      for (const url of draftUrls(after ?? {})) {
        const got = await fetchDraft(url);
        if (!got.ok || !isCleanDraft(got.body)) {
          console.error(`  VERIFY FAIL: ${url.slice(0, 60)} … (${got.ok ? "still dirty" : got.note})`);
          verified = false;
        }
      }
      if (verified) console.log(`  regen OK — clean AR + EN drafts verified for ${d.daycareName}`);
      else failures += 1;
    } catch (err) {
      console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
      failures += 1;
    }
  }

  if (failures === 0) {
    console.log(`VERIFY OK: ${dirty.length} daycare(s) regenerated with clean fenced-HTML drafts.`);
    console.log("Run me again — the second pass finds every draft clean and rewrites nothing.");
    return 0;
  }
  console.error(`${failures} regeneration failure(s) — fix the cause and re-run; clean daycares are never touched.`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
