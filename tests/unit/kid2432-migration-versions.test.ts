// KID-2432: the migration chain must carry one file per numeric version.
//
// The Supabase GitHub integration applies supabase/migrations through the
// Supabase CLI, whose ledger (supabase_migrations.schema_migrations) is keyed
// on the numeric version alone. Two files sharing a prefix (historically
// 0032 and 0033, from parallel branches) make the Supabase Preview check fail
// with "duplicate key value violates unique constraint schema_migrations_pkey"
// on every push that touches the migrations directory.
//
// The app's own ledger (lib/db.ts) is keyed on the file name, so it never
// noticed. This pin keeps the two ledgers compatible.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

const MIGRATION_DIR = "supabase/migrations";

function migrationFiles(): string[] {
  return readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

describe("KID-2432: migration version prefixes", () => {
  it("every numeric version prefix belongs to exactly one file", () => {
    const byVersion = new Map<string, string[]>();
    for (const file of migrationFiles()) {
      const version = file.slice(0, 4);
      expect(version).toMatch(/^\d{4}$/);
      byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    }
    const duplicates = [...byVersion.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([version, files]) => `${version}: ${files.join(", ")}`);
    expect(duplicates).toEqual([]);
  });

  it("versions sort into a strictly ascending chain", () => {
    const versions = migrationFiles().map((f) => Number(f.slice(0, 4)));
    expect(versions[0]).toBe(1);
    versions.slice(1).forEach((version, index) => {
      expect(version).toBeGreaterThan(versions[index]);
    });
  });

  it("the renumbered replay-safe migrations only use guarded DDL", () => {
    // KID-2432 relies on these two being safe to re-run: the Supabase Preview
    // branch is cloned from the production schema, where both objects already
    // exist, so an unguarded CREATE would fail the check a second way.
    for (const file of ["0043_push_subscriptions.sql", "0044_tool_usage_event.sql"]) {
      const sql = readFileSync(`${MIGRATION_DIR}/${file}`, "utf8");
      expect(sql.match(/CREATE TABLE (?!IF NOT EXISTS)/i)).toBeNull();
      expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    }
  });
});
