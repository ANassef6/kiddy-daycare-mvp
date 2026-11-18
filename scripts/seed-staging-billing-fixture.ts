/**
 * KID-2435: founder-facing staging fixture for the pricing-v2 billing module.
 *
 * Seeds ONE clearly-labelled centre ("Billing Test Daycare") into the staging
 * database so the operator portal shows a real pricing-v2 invoice:
 *   - 22 active children -> Core band (16-30), standard 950 EGP/month
 *   - founding client     -> year-1 Core rate 810 EGP/month
 *   - pilot ended 25 Sep, signed 1 Oct (inside the 14-day credit window)
 *                          -> 350 EGP credit on the first invoice (810 -> 460)
 *   - first cycle Oct 2026 -> one issued invoice whose snapshot columns show
 *                          the band, standard amount, founding rate and credit
 * The invoice is marked paid so the overdue rule never disables the fixture.
 *
 * SAFETY: this script refuses any target except a local SQLite `file:` URL or a
 * Postgres URL that matches the staging Supabase project named by
 * KIDDY_SEED_STAGING_PROJECT. The production project is never a valid target.
 *
 * Usage (staging):
 *   KIDDY_SEED_STAGING_PROJECT=<ref> \
 *   KIDDY_DATABASE_URL=postgres://... \
 *   npx tsx scripts/seed-staging-billing-fixture.ts
 */

const CENTER_NAME = "Billing Test Daycare";
const SUBDOMAIN = "billingtest";
const OWNER_EMAIL = "founder.billing@staging.kiddy.test";
const PASSWORD = "12345678";
const CHILD_COUNT = 22;
const FIRST_CYCLE = "2026-10-01";
const CHILDREN_ENROLLED = "2026-10-05";
const FOUNDING_STARTED = "2026-10-01";
const PILOT_END = "2026-09-25";

async function main() {
  const db = await import("../lib/db");
  guardNotProduction();
  await db.ensureSchema();
  await seed(db);
  process.exit(0);
}

function guardNotProduction() {
  const url = (process.env.KIDDY_DATABASE_URL ?? "").trim();
  if (/^file:/.test(url)) return; // local SQLite, explicit opt-in by URL scheme
  const ref = (process.env.KIDDY_SEED_STAGING_PROJECT ?? "").trim();
  if (/^[a-z0-9]{20}$/.test(ref) && isSupabaseProjectUrl(url, ref)) return;
  throw new Error(
    "KID-2435 staging fixture refused: set KIDDY_SEED_STAGING_PROJECT=<staging project ref> " +
      "and KIDDY_DATABASE_URL to the connection for exactly that project, or use a local " +
      "file: SQLite URL. The production database is never a valid target."
  );
}

function isSupabaseProjectUrl(raw: string, ref: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return false;
    const host = u.hostname.toLowerCase();
    const user = decodeURIComponent(u.username).toLowerCase();
    if (host === `db.${ref}.supabase.co`) return true;
    if (host.endsWith(".pooler.supabase.com") && user === `postgres.${ref}`) return true;
    return false;
  } catch {
    return false;
  }
}

async function seed(db: typeof import("../lib/db")) {
  const store = await import("../lib/store");
  const billing = await import("../lib/billing");

  // Repeatable: wipe only this fixture centre and its owner account.
  const existing = await db.queryGet("SELECT id FROM institute WHERE name = ?", CENTER_NAME);
  if (existing) {
    console.log(`KID-2435 staging fixture: removing previous ${CENTER_NAME}.`);
    await db.queryRun("DELETE FROM institute WHERE id = ?", String(existing.id));
  }
  await db.queryRun("DELETE FROM account WHERE lower(email) = ?", OWNER_EMAIL);

  const { instituteId } = await store.createDaycare({
    name: CENTER_NAME,
    subdomain: SUBDOMAIN,
    timeZone: "Africa/Cairo",
    primaryColor: "#0EA5E9",
    accentColor: "#22C55E",
    font: "Nunito",
    billing: { plan: "monthly" },
    ownerEmail: OWNER_EMAIL,
    ownerPassword: PASSWORD,
    ownerFullName: "Billing Test Owner",
  });

  const room = await store.createRoom(instituteId, "Billing Test Room", CHILD_COUNT);
  for (let i = 1; i <= CHILD_COUNT; i++) {
    await store.createChild({
      instituteId,
      firstName: `Billing Child ${i}`,
      lastName: "Test",
      dob: "2021-06-01",
      roomId: String(room.id),
      allergies: "None",
    });
  }
  // The cycle peak counts children active during Oct 2026, so the fixture's
  // 22 children are enrolled inside that cycle (never "now").
  await db.queryRun(
    "UPDATE child SET created_at = ? WHERE institute_id = ?",
    CHILDREN_ENROLLED,
    instituteId
  );

  await db.queryRun(
    `UPDATE daycare_billing
        SET plan = 'monthly', first_cycle_start = ?,
            founding_client = 1, founding_started_at = ?, pilot_end_date = ?
      WHERE institute_id = ?`,
    FIRST_CYCLE,
    FOUNDING_STARTED,
    PILOT_END,
    instituteId
  );

  const generated = await billing.generateDueInvoices();
  const invoices = await billing.listInvoices(instituteId);
  for (const invoice of invoices) {
    if (invoice.status !== "paid") await billing.markInvoicePaid(invoice.id, { paidAt: "2026-11-12T09:00:00.000Z" });
  }

  console.log(
    JSON.stringify(
      {
        instituteId,
        center: CENTER_NAME,
        subdomain: SUBDOMAIN,
        owner: OWNER_EMAIL,
        children: CHILD_COUNT,
        generated,
        invoices: invoices.map((i) => ({
          cycleMonth: i.cycleMonth,
          status: "paid",
          maxActiveChildren: i.maxActiveChildren,
          bandKey: i.bandKey,
          standardMonthlyEgp: i.standardMonthlyEgp,
          standardAmountEgp: i.standardAmountEgp,
          appliedMonthlyRateExact: i.appliedMonthlyRateExact,
          foundingApplied: i.foundingApplied,
          pilotCreditEgp: i.pilotCreditEgp,
          totalAmount: i.totalAmount,
        })),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("KID-2435 staging fixture failed:", err);
  process.exit(1);
});

export {};
