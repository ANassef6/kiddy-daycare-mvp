// KID-2494 follow-up: staging showed the generic "Something went wrong" screen
// on /portal/consents. The unit suite ran the consent queries on SQLite, where
// the creator lookup could be a correlated subquery inside a GROUP BY. Postgres
// rejects that shape with `subquery uses ungrouped column "cr.id" from outer
// query`, so the list never rendered. This pins the SQL against a real Postgres
// engine (PGlite) instead of only the SQLite mirror.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { Row } from "@/lib/db";
import {
  CONSENT_BATCHES_SQL,
  CONSENT_BATCH_CREATORS_SQL,
  CONSENT_BATCH_ROOMS_SQL,
  attachConsentBatchCreators,
} from "@/lib/consent-batches";

let db: PGlite;

function postgresParams(sql: string): string {
  return sql.replace(/\?/g, "$1");
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE consent_request (
      id TEXT PRIMARY KEY,
      institute_id TEXT NOT NULL,
      title TEXT,
      body TEXT,
      child_id TEXT,
      batch_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE audit_event (
      id TEXT PRIMARY KEY,
      institute_id TEXT,
      actor_name TEXT,
      entity_type TEXT,
      entity_id TEXT,
      action TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE child (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, room_id TEXT);
    CREATE TABLE room (id TEXT PRIMARY KEY, name TEXT);

    INSERT INTO room (id, name) VALUES ('r1', 'Sunflowers'), ('r2', 'Tulips');
    INSERT INTO child (id, first_name, last_name, room_id) VALUES
      ('c1', 'Mia', 'Hassan', 'r1'),
      ('c2', 'Omar', 'Saleh', 'r1');

    INSERT INTO consent_request (id, institute_id, title, body, child_id, batch_id, status, created_at) VALUES
      ('cr1', 'i1', 'Trip to the farm', 'Bring a hat.', 'c1', 'b1', 'approved', '2026-11-26T10:00:00Z'),
      ('cr2', 'i1', 'Trip to the farm', 'Bring a hat.', 'c2', 'b1', 'pending',  '2026-11-26T10:00:00Z'),
      ('legacy', 'i1', 'Old notice', 'General.', NULL, NULL, 'pending', '2026-11-25T09:00:00Z'),
      ('other', 'i2', 'Other centre', 'Hidden.', 'c9', 'b9', 'pending', '2026-11-26T11:00:00Z');

    INSERT INTO audit_event (id, institute_id, actor_name, entity_type, entity_id, action, created_at) VALUES
      ('a1', 'i1', 'Older Author', 'consent_request', 'cr1', 'create', '2026-11-26T09:59:00Z'),
      ('a2', 'i1', 'Newer Author', 'consent_request', 'cr1', 'create', '2026-11-26T10:00:00Z'),
      ('a3', 'i2', 'Other Author', 'consent_request', 'other', 'create', '2026-11-26T11:00:00Z');
  `);
});

afterAll(async () => {
  await db.close();
});

describe("consent batch queries on Postgres", () => {
  it("runs the grouped batch aggregate without a correlated subquery", async () => {
    const rows = (
      await db.query<{
        batch_id: string;
        title: string;
        total: number;
        pending: number;
        approved: number;
        denied: number;
        general_count: number;
      }>(postgresParams(CONSENT_BATCHES_SQL), ["i1"])
    ).rows;

    expect(rows.map((row) => row.batch_id).sort()).toEqual(["b1", "legacy"]);
    const trip = rows.find((row) => row.batch_id === "b1")!;
    expect(Number(trip.total)).toBe(2);
    expect(Number(trip.approved)).toBe(1);
    expect(Number(trip.pending)).toBe(1);
    expect(Number(trip.general_count)).toBe(0);
    const legacy = rows.find((row) => row.batch_id === "legacy")!;
    expect(Number(legacy.general_count)).toBe(1);
  });

  it("resolves the newest creator per batch from a separate portable query", async () => {
    const batches = (await db.query<Row>(postgresParams(CONSENT_BATCHES_SQL), ["i1"])).rows;
    const creators = (await db.query<Row>(postgresParams(CONSENT_BATCH_CREATORS_SQL), ["i1"])).rows;
    const withNames = attachConsentBatchCreators(batches, creators);

    expect(withNames.find((row) => row.batch_id === "b1")?.created_by_name).toBe("Newer Author");
    expect(withNames.find((row) => row.batch_id === "legacy")?.created_by_name).toBeNull();
  });

  it("lists the rooms of a batch without leaking another institute", async () => {
    const rows = (
      await db.query<{ batch_id: string; room_name: string }>(
        postgresParams(CONSENT_BATCH_ROOMS_SQL),
        ["i1"]
      )
    ).rows;

    expect(rows).toEqual([{ batch_id: "b1", room_name: "Sunflowers" }]);
  });
});
