import { getDb } from "./db";

let initialized = false;

// Ensure the app always has a seeded demo daycare on first load. Useful for a
// stateless host where the local SQLite file starts empty each cold start.
export function ensureSeeded(): void {
  if (initialized) return;
  const db = getDb();
  const c = db.prepare("SELECT COUNT(*) AS c FROM institute").get() as { c: number };
  if (c.c === 0) {
    // lazy require to avoid a db <-> seed module cycle
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { seedDemo } = require("./seed");
    seedDemo();
  }
  initialized = true;
}
