/**
 * KID-2440: founder-facing staging fixtures.
 *
 * Seeds ONE clearly-labelled centre ("Founder Test Daycare") into the
 * dedicated staging database so the founder can test every role before a
 * production cut:
 *   owner   founder.owner@staging.kiddy.test
 *   teacher founder.teacher@staging.kiddy.test
 *   parent  founder.parent@staging.kiddy.test
 * All three use the staging-only password 12345678.
 *
 * The data is representative: two rooms, two children, two guardians, working
 * hours, a daily report, one pending invoice and a staff roster.
 *
 * SAFETY: this script refuses to run against anything except an explicit
 * local SQLite `file:` URL or a Postgres URL that matches the staging Supabase
 * project named by KIDDY_SEED_STAGING_PROJECT. The production Supabase project
 * is never a valid target.
 *
 * Usage (staging):
 *   KIDDY_SEED_STAGING_PROJECT=<ref> \
 *   KIDDY_DATABASE_URL=postgres://... \
 *   npx tsx scripts/seed-staging-founder.ts
 */

const EMAIL_DOMAIN = "staging.kiddy.test";
const PASSWORD = "12345678";
const CENTER_NAME = "Founder Test Daycare";

const EMAILS = {
  owner: `founder.owner@${EMAIL_DOMAIN}`,
  teacher: `founder.teacher@${EMAIL_DOMAIN}`,
  parent: `founder.parent@${EMAIL_DOMAIN}`,
};

async function main() {
  const db = await import("../lib/db");
  guardNotProduction();
  await db.ensureSchema();
  await seed();
  process.exit(0);
}

function guardNotProduction() {
  const url = (process.env.KIDDY_DATABASE_URL ?? "").trim();
  if (/^file:/.test(url)) return; // local SQLite, explicit opt-in by URL scheme
  const ref = (process.env.KIDDY_SEED_STAGING_PROJECT ?? "").trim();
  if (/^[a-z0-9]{20}$/.test(ref) && isSupabaseProjectUrl(url, ref)) return;
  throw new Error(
    "KID-2440 staging seed refused: set KIDDY_SEED_STAGING_PROJECT=<staging project ref> " +
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

async function seed() {
  const db = await import("../lib/db");
  const store = await import("../lib/store");
  const { createAccount } = await import("../lib/auth");

  // Repeatable: wipe only this fixture centre and its three accounts.
  const existing = await db.queryGet("SELECT id FROM institute WHERE name = ?", CENTER_NAME);
  if (existing) {
    console.log(`KID-2440 staging seed: removing previous ${CENTER_NAME}.`);
    await db.queryRun("DELETE FROM institute WHERE id = ?", String(existing.id));
  }
  for (const email of Object.values(EMAILS)) {
    await db.queryRun("DELETE FROM account WHERE lower(email) = ?", email);
  }

  const { instituteId, branchIds } = await store.createDaycare({
    name: CENTER_NAME,
    subdomain: "foundertest",
    timeZone: "Africa/Cairo",
    primaryColor: "#4F46E5",
    accentColor: "#F59E0B",
    font: "Nunito",
    billing: { plan: "demo" },
    ownerEmail: EMAILS.owner,
    ownerPassword: PASSWORD,
    ownerFullName: "Founder Test Owner",
  });

  const roomA = await store.createRoom(instituteId, "Sunflowers", 12);
  const roomB = await store.createRoom(instituteId, "Little Stars", 10);

  // Teacher (account role staff + classroom-scoped staff row).
  const teacherStaff = await store.createStaff({
    instituteId,
    fullName: "Nour Teacher",
    role: "teacher",
    roomIds: [String(roomA.id)],
  });
  const teacherAccount = await createAccount({
    email: EMAILS.teacher,
    password: PASSWORD,
    fullName: "Nour Teacher",
    role: "staff",
  });
  await db.queryRun(
    "UPDATE account SET staff_id = ? WHERE id = ?",
    String(teacherStaff.id),
    String(teacherAccount.id)
  );

  const childA = await store.createChild({
    instituteId,
    firstName: "Layla",
    lastName: "Founder",
    dob: "2022-04-12",
    roomId: String(roomA.id),
    allergies: "None",
  });
  const childB = await store.createChild({
    instituteId,
    firstName: "Omar",
    lastName: "Founder",
    dob: "2021-11-03",
    roomId: String(roomB.id),
    allergies: "Pollen",
  });

  // Parent/guardian.
  await store.addContact({
    childId: String(childA.id),
    fullName: "Mona Founder",
    relationship: "parent",
    phone: "+20 100 000 0000",
    email: EMAILS.parent,
    isPickup: true,
    isEmergency: true,
  });
  await store.addContact({
    childId: String(childB.id),
    fullName: "Mona Founder",
    relationship: "parent",
    phone: "+20 100 000 0000",
    email: EMAILS.parent,
    isPickup: true,
    isEmergency: true,
  });
  const parentAccount = await createAccount({
    email: EMAILS.parent,
    password: PASSWORD,
    fullName: "Mona Founder",
    role: "parent",
    pin: "2468",
  });
  await store.linkFamily(String(parentAccount.id), String(childA.id), "parent");
  await store.linkFamily(String(parentAccount.id), String(childB.id), "parent");

  // Centre working hours: Sunday-Thursday, 07:00-18:00 (Africa/Cairo).
  await store.saveWorkingHours(instituteId, {
    0: { open: "07:00", close: "18:00" },
    1: { open: "07:00", close: "18:00" },
    2: { open: "07:00", close: "18:00" },
    3: { open: "07:00", close: "18:00" },
    4: { open: "07:00", close: "18:00" },
  });

  // A daily report + a pending invoice so the founder sees populated screens.
  const today = new Date().toISOString().slice(0, 10);
  await store.upsertDailyReport({
    childId: String(childA.id),
    reportDate: today,
    summary: "Layla painted a rainbow and shared the brushes with her friends.",
    observation: "Confident in the art corner.",
    mood: "happy",
    accountId: String(teacherAccount.id),
  });
  await store.createChildBilling({
    childId: String(childA.id),
    instituteId,
    description: "Staging test — monthly tuition",
    amountCents: 120000,
    currency: "EGP",
    period: today.slice(0, 7),
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  });

  console.log(`KID-2440 staging seed ready: ${CENTER_NAME} (${instituteId})`);
  console.log(`Branches: ${branchIds.length}; accounts: ${Object.values(EMAILS).join(", ")}`);
}

main().catch((err) => {
  console.error("KID-2440 staging seed failed:", err);
  process.exit(1);
});

export {};
