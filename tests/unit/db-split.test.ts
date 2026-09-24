// KID-115: pgExec split migration 0016 on every ";" — including one inside
// a "--" header comment (fragment starting with "this" -> 42601 on every
// ensureSchema call) and the semicolons inside the DO $$ block (orphaned
// `END IF` fragments). splitStatements only splits outside strings,
// comments, and dollar-quoted bodies.

import { describe, expect, it } from "vitest";
import { splitStatements } from "@/lib/db";
import fs from "fs";
import path from "path";

describe("splitStatements", () => {
  it("ignores semicolons inside line comments", () => {
    const parts = splitStatements("-- hello; this\nSELECT 1;\n");
    expect(parts).toEqual(["-- hello; this\nSELECT 1"]);
  });

  it("keeps DO $$ blocks whole", () => {
    const sql = "ALTER TABLE t ADD COLUMN c TEXT;\nDO $$\nBEGIN\nIF true THEN\nPERFORM 1;\nEND IF;\nEND\n$$;\nCREATE INDEX i ON t (c);";
    const parts = splitStatements(sql);
    expect(parts).toHaveLength(3);
    expect(parts[1]).toContain("DO $$");
    expect(parts[1]).toContain("END\n$$");
  });

  it("ignores semicolons inside string literals", () => {
    const parts = splitStatements("INSERT INTO t (a) VALUES ('x;y');\nSELECT 1;");
    expect(parts).toHaveLength(2);
  });

  it("splits migration 0016 into runnable statements", () => {
    const file = path.join(process.cwd(), "supabase", "migrations", "0016_contact_relationship_roles.sql");
    const parts = splitStatements(fs.readFileSync(file, "utf8"));
    // ALTER invite + 2 legacy-mapping UPDATEs + invite backfill + DO block + 3 indexes.
    expect(parts).toHaveLength(8);
    for (const part of parts) {
      expect(part).not.toMatch(/^this\b/i);
      expect(part).not.toBe("END IF");
    }
    expect(parts[4]).toContain("DO $$");
  });

  it("splits every migration file without bare fragments", () => {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const parts = splitStatements(fs.readFileSync(path.join(dir, file), "utf8"));
      expect(parts.length, file).toBeGreaterThan(0);
      for (const part of parts) {
        // No fragment may start with stray prose or a mid-block keyword.
        expect(part, `${file}: ${part.slice(0, 40)}`).not.toMatch(/^(this|END IF|END\b|ELSE)\b/i);
      }
    }
  });
});
