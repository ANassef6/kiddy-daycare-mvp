// Shared helpers for the Kiddy QA suite. Every suite uses the isolated local
// SQLite data layer (see vitest.config.ts env) so tests never touch the shared
// Supabase Postgres database.

import { ensureSchema, queryRun, type Row } from "@/lib/db";
import { seedDemo } from "@/lib/seed";

// Tables in FK-safe drop order (referencing tables first).
const TABLES = [
  "newsfeed_tag",
  "newsfeed_like",
  "newsfeed_comment",
  "staff_room",
  "family_member",
  "enrollment",
  "child_health",
  "contact",
  "attendance_schedule",
  "check_in",
  "daily_report",
  "payment",
  "payment_method",
  "invoice",
  "billing_plan",
  "media",
  "incident_report",
  "consent_request",
  "message",
  "newsfeed_post",
  "invite",
  "room",
  "branch",
  "child",
  "staff",
  "account",
  "institute",
];

// Resets the database to an empty schema. FK checks are suspended during the
// drop batch: with foreign_keys = ON, SQLite refuses to drop a table whose
// referencing table was already removed (schema FK resolution fails).
export async function resetDb(): Promise<void> {
  await queryRun("PRAGMA foreign_keys = OFF");
  for (const table of TABLES) {
    await queryRun(`DROP TABLE IF EXISTS ${table}`);
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