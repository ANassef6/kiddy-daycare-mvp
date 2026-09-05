import { queryGet } from "./db";

let initialized = false;

// Ensure the app always has a seeded demo daycare on first load. Applies the
// schema idempotently and seeds demo data when no institute exists yet.
export async function ensureSeeded(): Promise<void> {
  await ensureSchema();
  if (initialized) return;
  const row = await queryGet("SELECT COUNT(*) AS c FROM institute");
  if ((row?.c as number) === 0) {
    // lazy require to avoid a db <-> seed module cycle
    const { seedDemo } = await import("./seed");
    await seedDemo();
  }
  // Keep the live demo explorable: add M3 billing demo rows only while the
  // daycare has no invoices yet. Never overwrites real billing activity.
  try {
    const { seedBillingDemo } = await import("./seed");
    await seedBillingDemo();
  } catch {
    // non-fatal — billing tables may not exist on very old DBs until schema applies
  }
  initialized = true;
}

async function ensureSchema() {
  const { ensureSchema: es } = await import("./db");
  await es();
}