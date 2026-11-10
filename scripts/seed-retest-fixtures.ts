/**
 * KID-1272: two-tenant synthetic retest fixtures for the authenticated
 * security retest.
 * Creates two fully synthetic daycares ("Maple Grove Daycare", "Blue Horizon
 * Kids" — no real tenant data) with the full role matrix per tenant:
 *   platform operator  operator@kiddy-retest.test   (platform sentinel)
 *   owner              the daycare creator account
 *   admin              account role admin + staff row role admin
 *   teacher            account role staff + staff row teacher, room 1 only
 *   carer (caregiver)  account role carer + staff row caregiver, room 2 only
 *   parent             family link "parent" (full parent portal)
 *   family             family link "family" (read + daily loop + messaging)
 *   pickup             family link "pickup" (pickup registration only)
 *
 * plus rooms, children, contact rows, invoices (pending / paid / overdue),
 * a daily report, an incident, a message thread + a DM, a form + parent
 * response, an approved consent, working hours, and today's check-in/out
 * state.
 *
 * LOCAL / STAGING ONLY. The seed refuses to run against anything but the
 * local SQLite engine (an explicit `file:` KIDDY_DATABASE_URL) — never the
 * production Supabase, and never without the operator's own staging choice.
 * KID-1500: two more allowed targets, each gated by its own explicit opt-in:
 *   (a) the isolated `kiddy_staging` Postgres database (database-name mode:
 *       KIDDY_SEED_STAGING=kiddy_staging plus a URL whose database name is
 *       exactly kiddy_staging);
 *   (b) a dedicated staging Supabase project (project mode:
 *       KIDDY_SEED_STAGING_PROJECT=<ref> plus a URL that points to exactly
 *       that project ref — db.<ref>.supabase.co, or a pooler host with the
 *       postgres.<ref> user). The production Supabase project is never a
 *       target in either mode.
 *
 * Repeatable:
 *   - from a clean database it runs plainly;
 *   - on an already-seeded database it wipes ONLY the two fixture institutes
 *     and their own rows first, then re-creates them, so the documented
 *     credentials (see the task's private credential document) stay stable.
 *
 * Usage (repo root):
 *   KIDDY_DATABASE_URL=file:./data/retest-fixture.db npx tsx scripts/seed-retest-fixtures.ts
 *   # isolated kiddy_staging Postgres database (KID-1500), NOT for production:
 *   KIDDY_DATABASE_URL=postgres://host/kiddy_staging KIDDY_SEED_STAGING=kiddy_staging \
 *     npx tsx scripts/seed-retest-fixtures.ts
 *   # dedicated staging Supabase project (KID-1500), NOT for production — its
 *   # default database is named postgres; isolation is the project ref itself:
 *   KIDDY_DATABASE_URL=postgres://db.<ref>.supabase.co/postgres \
 *   KIDDY_SEED_STAGING_PROJECT=<ref> npx tsx scripts/seed-retest-fixtures.ts
 */

const EMAIL_DOMAIN = "kiddy-retest.test";

const PASSWORDS = {
  operator: "retest-operator-9001",
  owner: "retest-owner-9001",
  admin: "retest-admin-9001",
  teacher: "retest-teacher-9001",
  carer: "retest-carer-9001",
  parent: "retest-parent-9001",
  family: "retest-family-9001",
  pickup: "retest-pickup-9001",
} as const;

interface TenantSpec {
  name: string;
  subdomain: string;
  primaryColor: string;
  accentColor: string;
  font: string;
  slug: string;
  rooms: [string, string];
  children: Array<{
    firstName: string;
    lastName: string;
    dob: string;
    allergies: string;
  }>;
}

const TENANTS: TenantSpec[] = [
  {
    name: "Maple Grove Daycare",
    subdomain: "maplegrove",
    primaryColor: "#2F855A",
    accentColor: "#DD6B20",
    font: "Nunito",
    slug: "maple",
    rooms: ["Acorn", "Willow"],
    children: [
      { firstName: "Aria", lastName: "Maple", dob: "2021-03-15", allergies: "None" },
      { firstName: "Theo", lastName: "Maple", dob: "2020-06-22", allergies: "Pollen" },
    ],
  },
  {
    name: "Blue Horizon Kids",
    subdomain: "bluehorizon",
    primaryColor: "#2B6CB0",
    accentColor: "#D69E2E",
    font: "Quicksand",
    slug: "horizon",
    rooms: ["Lagoon", "Drift"],
    children: [
      { firstName: "Nova", lastName: "Horizon", dob: "2022-01-09", allergies: "None" },
      { firstName: "Imani", lastName: "Horizon", dob: "2021-08-30", allergies: "None" },
    ],
  },
];

async function main() {
  const db = await import("../lib/db");
  // Guard BEFORE ensureSchema(): the Postgres path of ensureSchema() applies
  // migrations, so a refused target must be refused before any DDL happens.
  await guardNotProduction();
  await db.ensureSchema();

  await seedFixturesImpl();
  process.exit(0);
}

/**
 * Refusal rail: local SQLite `file:` URLs by default, never a
 * shared/production DB.
 *
 * KID-1500 staging opt-ins, two exclusive modes:
 *  - `KIDDY_SEED_STAGING=kiddy_staging`: an isolated database named
 *    `kiddy_staging` (the URL's database name must match exactly).
 *  - `KIDDY_SEED_STAGING_PROJECT=<ref>`: a dedicated staging Supabase project
 *    (the URL must be a Supabase connection for exactly that project ref —
 *    db.<ref>.supabase.co, or a Supabase pooler host with the postgres.<ref>
 *    user; the default database `postgres` there is fine because isolation is
 *    carried by the ref itself). A valid Supabase ref is 20 lowercase
 *    alphanumerics; malformed flags or foreign hosts are refused.
 * In both modes production stays unreachable even with the flag set, and the
 * flag alone can never widen the target beyond the confirmed staging project.
 */
async function guardNotProduction() {
  const url = (process.env.KIDDY_DATABASE_URL ?? "").trim();
  if (/^file:/.test(url)) return; // local SQLite file: URL, unchanged behavior
  if (process.env.KIDDY_SEED_STAGING === "kiddy_staging") {
    try {
      const u = new URL(url);
      const dbname = decodeURIComponent(u.pathname.replace(/^\//, ""));
      if ((u.protocol === "postgres:" || u.protocol === "postgresql:") && dbname === "kiddy_staging") {
        return;
      }
    } catch {
      // fall through to the refusal below (unparseable URL is never a target)
    }
    throw new Error(
      "KID-1500 staging seed: KIDDY_SEED_STAGING=kiddy_staging requires KIDDY_DATABASE_URL " +
        "to be the kiddy_staging Postgres database (got a different database name or a " +
        "non-Postgres URL). The production Supabase is never a fixture target."
    );
  }
  const stagingProjectRef = (process.env.KIDDY_SEED_STAGING_PROJECT ?? "").trim();
  if (stagingProjectRef) {
    if (/^[a-z0-9]{20}$/.test(stagingProjectRef) && isSupabaseProjectUrl(url, stagingProjectRef)) {
      return;
    }
    throw new Error(
      "KID-1500 staging seed: KIDDY_SEED_STAGING_PROJECT=<ref> requires KIDDY_DATABASE_URL " +
        "to be a Supabase Postgres connection for exactly that staging project ref " +
        "(db.<ref>.supabase.co, or a Supabase pooler host with the postgres.<ref> user; " +
        "a plain/default database URI or the production project ref is refused). " +
        "The production Supabase is never a fixture target."
    );
  }
  throw new Error(
    "KID-1272 fixture seed: KIDDY_DATABASE_URL must be an explicit local file: SQLite URL " +
      "(local/staging only — for the isolated kiddy_staging Postgres target set " +
      "KIDDY_SEED_STAGING=kiddy_staging, or set KIDDY_SEED_STAGING_PROJECT=<ref> for the " +
      "dedicated staging Supabase project; the production Supabase is never a fixture target)."
  );
}

/**
 * True only when the URL is a Postgres connection to Supabase infrastructure
 * that embeds precisely the confirmed staging project ref: the direct host
 * `db.<ref>.supabase.co`, or a Supabase pooler host whose username is
 * `postgres.<ref>`.
 */
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

// The implementation lives in this same file below (no second module).

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedFixturesImpl() {
  const db = await import("../lib/db");
  const store = await import("../lib/store");
  const { createAccount } = await import("../lib/auth");
  const { ensurePlatformOperator } = await import("../lib/seed");

  // ensurePlatformOperator reads PLATFORM_ADMIN_EMAIL / PLATFORM_OPERATOR_PASSWORD
  // at call time; the fixtures pin the retest operator identity explicitly.
  process.env.PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL || `operator@${EMAIL_DOMAIN}`;
  process.env.PLATFORM_OPERATOR_PASSWORD = process.env.PLATFORM_OPERATOR_PASSWORD || PASSWORDS.operator;
  await ensurePlatformOperator();

  for (const tenant of TENANTS) {
    const existing = await db.queryGet("SELECT id FROM institute WHERE name = ?", tenant.name);
    if (existing) {
      console.log(`KID-1272 fixtures: ${tenant.name} already present — wiping its rows first (repeatable seed).`);
      await wipeTenant(String(existing.id));
    }

    // Owner + institute + branches + the subscription billing row.
    await store.createDaycare({
      name: tenant.name,
      primaryColor: tenant.primaryColor,
      accentColor: tenant.accentColor,
      font: tenant.font,
      subdomain: tenant.subdomain,
      billing: { plan: "demo" },
      ownerEmail: `${tenant.slug}-owner@${EMAIL_DOMAIN}`,
      ownerPassword: PASSWORDS.owner,
      ownerFullName: `${tenant.slug} Owner`,
    });

    const inst = (await db.queryGet("SELECT id FROM institute WHERE name = ?", tenant.name))!;
    const iid = String(inst.id);

    // Rooms
    const roomIds: string[] = [];
    for (const roomName of tenant.rooms) {
      const room = await store.createRoom(iid, roomName, 10);
      roomIds.push(String(room.id));
    }

    // --- the staff role matrix --------------------------------------------
    const adminStaff = await store.createStaff({ instituteId: iid, fullName: `${tenant.name} Admin`, role: "admin" });
    const adminAccount = await createAccount({
      email: `${tenant.slug}-admin@${EMAIL_DOMAIN}`,
      password: PASSWORDS.admin,
      fullName: `${tenant.name} Admin`,
      role: "admin",
    });
    await db.queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(adminStaff.id), String(adminAccount.id));

    // teacher: classroom-scoped to room 1 only (the scoping probe).
    const teacherStaff = await store.createStaff({
      instituteId: iid,
      fullName: `${tenant.name} Teacher`,
      role: "teacher",
      roomIds: [roomIds[0]],
    });
    const teacherAccount = await createAccount({
      email: `${tenant.slug}-teacher@${EMAIL_DOMAIN}`,
      password: PASSWORDS.teacher,
      fullName: `${tenant.name} Teacher`,
      role: "staff",
    });
    await db.queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(teacherStaff.id), String(teacherAccount.id));

    // caregiver: the carer role, scoped to room 2.
    const carerStaff = await store.createStaff({
      instituteId: iid,
      fullName: `${tenant.name} Carer`,
      role: "caregiver",
      roomIds: [roomIds[1]],
    });
    const carerAccount = await createAccount({
      email: `${tenant.slug}-carer@${EMAIL_DOMAIN}`,
      password: PASSWORDS.carer,
      fullName: `${tenant.name} Carer`,
      role: "carer",
    });
    await db.queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(carerStaff.id), String(carerAccount.id));

    // --- children + the guardian contact row -------------------------------
    const childA = await store.createChild({
      instituteId: iid,
      firstName: tenant.children[0].firstName,
      lastName: tenant.children[0].lastName,
      dob: tenant.children[0].dob,
      roomId: roomIds[0],
      allergies: tenant.children[0].allergies,
    });
    const childB = await store.createChild({
      instituteId: iid,
      firstName: tenant.children[1].firstName,
      lastName: tenant.children[1].lastName,
      dob: tenant.children[1].dob,
      roomId: roomIds[1],
      allergies: tenant.children[1].allergies,
    });

    await store.addContact({
      childId: String(childA.id),
      fullName: `${tenant.name} Guardian`,
      relationship: "parent",
      phone: "+1 555 0101",
      email: `${tenant.slug}-parent@${EMAIL_DOMAIN}`,
      isPickup: true,
      isEmergency: true,
    });

    // --- the family role matrix --------------------------------------------
    const parentAccount = await createAccount({
      email: `${tenant.slug}-parent@${EMAIL_DOMAIN}`,
      password: PASSWORDS.parent,
      fullName: `${tenant.name} Parent`,
      role: "parent",
      pin: "9911",
    });
    await store.linkFamily(String(parentAccount.id), String(childA.id), "parent");
    await store.linkFamily(String(parentAccount.id), String(childB.id), "parent");

    const familyAccount = await createAccount({
      email: `${tenant.slug}-family@${EMAIL_DOMAIN}`,
      password: PASSWORDS.family,
      fullName: `${tenant.name} Family`,
      role: "parent",
    });
    await store.linkFamily(String(familyAccount.id), String(childA.id), "family");

    const pickupAccount = await createAccount({
      email: `${tenant.slug}-pickup@${EMAIL_DOMAIN}`,
      password: PASSWORDS.pickup,
      fullName: `${tenant.name} Pickup`,
      role: "parent",
    });
    await store.linkFamily(String(pickupAccount.id), String(childA.id), "pickup");

    // --- the daily loop ------------------------------------------------------
    await store.upsertDailyReport({
      childId: String(childA.id),
      reportDate: today(),
      summary: `${tenant.children[0].firstName} painted a whole mural today.`,
      observation: "Loves the easel corner.",
      mood: "happy",
      accountId: String(carerAccount.id),
    });

    await store.createIncident({
      instituteId: iid,
      childId: String(childB.id),
      accountId: String(carerAccount.id),
      type: "minor-injury",
      description: "Scraped knee on the climbing rope, ice pack applied, guardian called.",
    });

    // --- forms + consents -----------------------------------------------------
    const form = await store.createForm({
      instituteId: iid,
      kind: "survey",
      title: `${tenant.name} — parent-teacher conference survey`,
      description: "Retest fixture form.",
      fieldsJson: JSON.stringify([
        { id: "f0", label: "Preferred slot", type: "select", options: ["Morning", "Afternoon"], required: true },
        { id: "f1", label: "Topics", type: "textarea", required: false },
      ]),
      accountId: String(adminAccount.id),
    });
    await store.saveFormResponse({
      formId: String(form.id),
      accountId: String(parentAccount.id),
      childId: String(childA.id),
      answersJson: JSON.stringify({ f0: "Afternoon", f1: "Reading progress" }),
    });

    const consent = await store.createConsent({
      instituteId: iid,
      title: "Photography at retest events",
      body: "Approve photos of your child at retest events only?",
      childId: String(childA.id),
    });
    await store.respondConsent(String(consent.id), "approved");

    // --- messaging --------------------------------------------------------------
    await store.createMessageThread({
      instituteId: iid,
      title: "Pickup coordination",
      isGroup: true,
      createdBy: String(adminAccount.id),
      participantIds: [String(adminAccount.id), String(parentAccount.id), String(teacherAccount.id)],
    });
    await store.sendMessage({
      instituteId: iid,
      senderAccountId: String(parentAccount.id),
      recipientAccountId: String(adminAccount.id),
      body: "Friday pickup needs to be earlier — message the group please.",
      threadId: null,
    });

    // --- invoices: pending / paid / overdue -------------------------------------
    // createChildBilling notifies the linked parent accounts (KID-684 rides
    // the create path); the fixture wants exactly that real behavior.
    await store.createChildBilling({
      childId: String(childA.id),
      instituteId: iid,
      description: "Retest fixture — October tuition (pending)",
      amountCents: 125000,
      currency: "USD",
      period: "2026-10",
      dueDate: futureDate(7),
    });
    await store.createChildBilling({
      childId: String(childA.id),
      instituteId: iid,
      description: "Retest fixture — September tuition (paid)",
      amountCents: 125000,
      currency: "USD",
      period: "2026-09",
      dueDate: futureDate(-30),
      status: "paid",
    });
    await store.createChildBilling({
      childId: String(childB.id),
      instituteId: iid,
      description: "Retest fixture — overdue activity fee (overdue)",
      amountCents: 4500,
      currency: "USD",
      period: "2026-08",
      dueDate: futureDate(-14),
    });

    // Working hours + today's check-in/out state: childA is IN (the pickup
    // account registers the pickup time on the way out), childB is IN then OUT.
    await store.saveWorkingHours(iid, workingWeek());
    await store.checkChildInOut({ childId: String(childA.id), accountId: String(adminAccount.id), type: "in" });
    await store.checkChildInOut({ childId: String(childB.id), accountId: String(adminAccount.id), type: "in" });
    await store.checkChildInOut({ childId: String(childB.id), accountId: String(parentAccount.id), type: "out" });
    // The pickup link's own surface: the pickup account registers a pickup time.
    await store.checkChildInOut({ childId: String(childA.id), accountId: String(pickupAccount.id), type: "out" });

    console.log(`Seeded retest fixtures for ${tenant.name} (${iid})`);
  }
}

/** Removes every row of exactly this institute plus the fixture accounts —
 *  never any other institute's rows. The SQLite schema carries the FK
 *  cascades (lib/sqlite-schema.ts): deleting the institute row takes the
 *  branch/room/staff/child subtrees and every institute- or child-scoped
 *  table with it; deleting each fixture account takes its links, messages,
 *  notifications and push subscriptions. `SET NULL` FKs leave harmless
 *  audit/log rows with a null actor — acceptable for a retest fixture wipe. */
async function wipeTenant(instituteId: string) {
  const db = await import("../lib/db");

  await db.queryRun("DELETE FROM institute WHERE id = ?", instituteId);

  // Fixture accounts by email domain, owned by this retest ONLY.
  await db.queryAll(`SELECT id FROM account WHERE lower(email) LIKE '%@${EMAIL_DOMAIN}'`).then(async (accounts) => {
    for (const a of accounts) {
      await db.queryRun("DELETE FROM account WHERE id = ?", String(a.id));
    }
  });
}

function workingWeek() {
  const { open, close } = { open: "07:00", close: "18:00" };
  return {
    1: { open, close },
    2: { open, close },
    3: { open, close },
    4: { open, close },
    5: { open, close },
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function futureDate(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error("KID-1272 fixture seed failed:", err);
  process.exit(1);
});

export {};
