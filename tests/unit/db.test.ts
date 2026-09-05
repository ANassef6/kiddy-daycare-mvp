// Data-layer primitives: query API, schema application, uid collisions.

import { beforeEach, describe, expect, it } from "vitest";
import { ensureSchema, queryAll, queryGet, queryRun, uid, isPostgresMode } from "@/lib/db";
import { resetDb } from "../helpers";

beforeEach(async () => {
  await resetDb();
});

describe("query API", () => {
  it("insert/select/update round-trips", async () => {
    await resetDb();
    const id = uid();
    await queryRun("INSERT INTO institute (id, name) VALUES (?, ?)", id, "Round Trip Daycare");
    const row = (await queryGet("SELECT * FROM institute WHERE id = ?", id))!;
    expect(row.name).toBe("Round Trip Daycare");
    await queryRun("UPDATE institute SET name = ? WHERE id = ?", "Renamed", id);
    expect((await queryGet("SELECT name FROM institute WHERE id = ?", id))!.name).toBe("Renamed");
    const all = await queryAll("SELECT id FROM institute");
    expect(all).toHaveLength(1);
  });

  it("ensureSchema is idempotent", async () => {
    await ensureSchema();
    await ensureSchema();
    const rows = await queryAll("SELECT name FROM sqlite_master WHERE type='table'");
    const names = rows.map((r) => r.name);
    for (const t of ["institute", "room", "child", "check_in", "daily_report", "invoice", "payment"]) {
      expect(names).toContain(t);
    }
  });

  it("uid generates unique ids without collisions at volume", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) ids.add(uid());
    expect(ids.size).toBe(500);
  });
});

describe("engine selection", () => {
  it("isPostgresMode is false under the test env (file: URL)", () => {
    expect(isPostgresMode()).toBe(false);
  });
});