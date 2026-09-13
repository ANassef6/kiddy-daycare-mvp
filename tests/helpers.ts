// Shared helpers for the Kiddy QA suite. Every suite uses the isolated local
// SQLite data layer (see vitest.config.ts env) so tests never touch the shared
// Supabase Postgres database.

import { ensureSchema, queryAll, queryRun, type Row } from "@/lib/db";
import { seedDemo } from "@/lib/seed";

// Drops every user table in the test database, then re-applies the schema.
// Handles new tables automatically so the helpers never need manual updates.
export async function resetDb(): Promise<void> {
  await queryRun("PRAGMA foreign_keys = OFF");
  const tables = await queryAll(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  for (const t of tables) {
    await queryRun(`DROP TABLE IF EXISTS [${String(t.name)}]`);
  }
  await queryRun("PRAGMA foreign_keys = ON");
  await ensureSchema();
}

// Resets and seeds the standard demo daycare (Sunshine Daycare) so tests start
// from a known, reproducible fixture.
export async function seedFixture(): Promise<void> {
  await resetDb();
  await seedDemo();
}

// Strict helper for lookup queries that must resolve: throws on a missing row
// instead of returning `Row | undefined`, keeping tests strict-TS clean.
export async function mustGet(sql: string, ...args: unknown[]): Promise<Row> {
  const { queryGet } = await import("@/lib/db");
  const row = await queryGet(sql, ...args);
  if (row === undefined) throw new Error(`mustGet: no row for query \`${sql}\``);
  return row;
}