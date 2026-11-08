// KID-745: the signed daycare contract.
//
// Two layers, mirroring lib/payment-proof.ts:
//   1. Pure boundary helpers — validation and the storage path — that the
//      upload action (lib/actions.ts) runs BEFORE any storage or database
//      write, so an unsupported file can never create a partial record.
//   2. The store read/writers for the daycare_contract row (migration 0038 /
//      mirror in lib/sqlite-schema.ts). One row per daycare (institute_id is
//      the primary key); the signed snapshot (signed_url + signed_file_name +
//      signed_uploaded_at + uploaded_by_account_id) always moves together, so
//      a replacement upload can never leave a stale pointer behind.

import { ensureSchema, isPostgresMode, queryGet, queryRun } from "@/lib/db";
import type { Row } from "@/lib/db";

export const MAX_CONTRACT_BYTES = 10 * 1024 * 1024;

export const CONTRACT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

export type ContractValidation =
  | { ok: true; ext: string }
  | { ok: false; code: "type" | "size" };

/** A signed contract is a PDF, PNG or JPG capped at 10 MB. Empty and
 *  wrong-type files both read as a type failure — the caller turns the code
 *  into a localized banner before anything is stored. */
export function validateContract(file: { type?: unknown; size?: unknown }): ContractValidation {
  const size = Number(file.size ?? 0);
  if (size > MAX_CONTRACT_BYTES) return { ok: false, code: "size" };
  const type = String(file.type ?? "").toLowerCase();
  const ext = CONTRACT_TYPES[type];
  if (!ext || !(size > 0)) return { ok: false, code: "type" };
  return { ok: true, ext };
}

/** Object path inside the kiddy-public bucket. CONFIDENTIALITY LIMITATION
 *  (documented for KID-745): the platform has no private bucket or
 *  service-key signed-URL flow — lib/supabase.ts holds only the public
 *  bucket this app already uses — so the object is placed under a
 *  per-daycare folder with a timestamp + long random UUID suffix. That keeps
 *  the URL unguessable to other tenants, but an unguessable-PUBLIC object is
 *  not the same as a private one: whoever obtains the exact URL can fetch
 *  the file. The URL is only ever written to daycare_contract (operator-only
 *  surface) and the audit trail deliberately carries none of it. A private
 *  bucket / signed-URL migration should replace this path once storage infra
 *  allows. */
export function contractStorageFilename(instituteId: string, ext: string, randomSuffix: string): string {
  return `contracts/${instituteId}/signed-${Date.now()}-${randomSuffix}.${ext}`;
}

export type DaycareContractRow = Row & {
  institute_id: string;
  template_version: string | null;
  draft_url: string | null;
  draft_generated_at: string | null;
  signed_url: string | null;
  signed_file_name: string | null;
  signed_uploaded_at: string | null;
  uploaded_by_account_id: string | null;
};

/** The one contract row for a daycare — never another tenant's: the row is
 *  keyed by institute_id and every caller passes its own verified id. */
export async function getDaycareContract(
  instituteId: string
): Promise<DaycareContractRow | undefined> {
  return (await queryGet("SELECT * FROM daycare_contract WHERE institute_id = ?", instituteId)) as
    | DaycareContractRow
    | undefined;
}

/** Uploader display name for the contract card — null when the account was
 *  deleted (uploaded_by_account_id is SET NULL; the card then shows no
 *  uploader line). */
export async function getDaycareContractUploaderName(
  accountId: string
): Promise<string | null> {
  const row = await queryGet("SELECT full_name FROM account WHERE id = ?", accountId);
  if (!row) return null;
  return String(row.full_name ?? "") || null;
}

/** Upsert the CURRENT signed-contract snapshot. Replace-or-create in one
 *  statement (both engines accept ON CONFLICT; lib/platform-settings.ts uses
 *  the same shape): the four signed columns move together, updated_at is
 *  recomputed on every write so a replacement always moves the timestamp,
 *  and the template/draft columns are never touched here — the content task
 *  owns the draft. */
export async function setDaycareContractSigned(
  instituteId: string,
  patch: {
    signedUrl: string;
    signedFileName: string;
    signedUploadedAt: string;
    uploadedByAccountId: string;
  }
): Promise<void> {
  // Reaching into daycare_contract before the schema exists must never throw
  // the action away — migrate-on-boot covers the app; a fresh test database
  // and pg warm instances both already have it (same split as
  // setPlatformSetting).
  await ensureSchema();
  const nowExpr = isPostgresMode() ? "now()" : "datetime('now')";
  await queryRun(
    `INSERT INTO daycare_contract
       (institute_id, template_version, draft_url, draft_generated_at, signed_url,
        signed_file_name, signed_uploaded_at, uploaded_by_account_id, created_at, updated_at)
     VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, ${nowExpr}, ${nowExpr})
     ON CONFLICT (institute_id) DO UPDATE SET
       signed_url = excluded.signed_url,
       signed_file_name = excluded.signed_file_name,
       signed_uploaded_at = excluded.signed_uploaded_at,
       uploaded_by_account_id = excluded.uploaded_by_account_id,
       updated_at = ${nowExpr}`,
    instituteId,
    patch.signedUrl,
    patch.signedFileName,
    patch.signedUploadedAt,
    patch.uploadedByAccountId
  );
}
