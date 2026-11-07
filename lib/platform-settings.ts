// KID-737: the platform-wide operator settings.
//
// One row per key in platform_setting (migration 0037). The table lives
// OUTSIDE any institute — these are platform settings (the Kiddy team's), not
// tenant data. KID-737 stores exactly one key, 'instapay_url': the
// subscription payment link every owner sees on /portal/account-billing.
//
// Representation rules:
//   - a link is stored as the raw string (the boundary parser
//     lib/instapay.ts parsePaymentLink already validated it — the caller
//     stores only when parsePaymentLink returned ok);
//   - a CLEARED link is the ABSENCE of a row: setPlatformSetting with a null
//     value deletes the key, so "never set" and "cleared" read the same;
//   - the writer is the server action (operator-gated) only — this module
//     performs no role checks of its own (same split as the other stores).

import { ensureSchema, isPostgresMode, queryRun } from "./db";

export const PLATFORM_INSTAPAY_KEY = "instapay_url";

export async function setPlatformSetting(
  key: string,
  value: string | null,
  updatedByAccountId: string | null
): Promise<void> {
  // Reaching into platform_setting before the schema exists must never throw
  // the action away — the rest of the app relies on migrate-on-boot, but a
  // fresh test database (resetDb -> sqliteSchema) and pg warm instances both
  // already have it; this call is a no-op there.
  await ensureSchema();
  if (value === null) {
    await queryRun("DELETE FROM platform_setting WHERE key = ?", key);
    return;
  }
  // Both engines accept the same upsert: updated_at is recomputed on every
  // write so an operator re-save moves the timestamp even when the value is
  // unchanged.
  const nowExpr = isPostgresMode() ? "now()" : "datetime('now')";
  await queryRun(
    `INSERT INTO platform_setting (key, value, updated_by_account_id, updated_at)
     VALUES (?, ?, ?, ${nowExpr})
     ON CONFLICT (key) DO UPDATE SET
       value = excluded.value,
       updated_by_account_id = excluded.updated_by_account_id,
       updated_at = ${nowExpr}`,
    key,
    value,
    updatedByAccountId
  );
}

export async function getPlatformSetting(key: string): Promise<{
  value: string;
  uploadedAt: string;
} | undefined> {
  const { queryGet } = await import("./db");
  const row = await queryGet("SELECT value, updated_at FROM platform_setting WHERE key = ?", key);
  return row
    ? { value: String(row.value ?? ""), uploadedAt: String(row.updated_at ?? "") }
    : undefined;
}

/** The platform Instapay link the owner billing page opens, or null when no
 *  link is set (missing row or freshly cleared). The URL is never
 *  reconstructed — whatever the operator stored is what opens. */
export async function getPlatformInstapayUrl(): Promise<string | null> {
  const row = await getPlatformSetting(PLATFORM_INSTAPAY_KEY);
  return row && row.value.trim() ? row.value.trim() : null;
}
