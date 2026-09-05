import { queryGet } from "./db";
import * as store from "./store";
import { createAccount } from "./auth";

// Seeds M3 billing demo data (plan + open invoice per demo child) into an
// already-seeded daycare. Guarded: only runs when no invoices exist yet, so it
// never pollutes a daycare that has started real billing. Called on app boot
// via bootstrap.ts (does not overwrite existing billing activity).
export async function seedBillingDemo() {
  const inst = await queryGet("SELECT id FROM institute ORDER BY created_at LIMIT 1");
  if (!inst) return { skipped: true as const, reason: "no institute" };
  const invoiceCount = await queryGet("SELECT COUNT(*) AS c FROM invoice");
  if ((invoiceCount?.c as number) > 0) return { skipped: true as const, reason: "invoices already exist" };

  const iid = inst.id as string;
  const owner = await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1");
  const children = await store.listChildren(iid);
  const demos: Array<{ childName: string; planName: string; amountCents: number }> = [
    { childName: "Ella", planName: "Full-time toddler", amountCents: 120000 },
    { childName: "Leo", planName: "Preschool half-day", amountCents: 95000 },
  ];
  for (const d of demos) {
    const child = children.find((c: any) => c.first_name === d.childName);
    if (!child) continue;
    await store.upsertChildPlan({
      instituteId: iid,
      childId: child.id as string,
      planName: d.planName,
      amountCents: d.amountCents,
      billingPeriod: "monthly",
      updatedByAccountId: owner?.id as string | undefined,
    });
    await store.createInvoice({
      instituteId: iid,
      childId: child.id as string,
      description: "September tuition",
      amountCents: d.amountCents,
      dueDate: new Date().toISOString().slice(0, 8) + "01",
      createdByAccountId: owner?.id as string | undefined,
    });
  }
  console.log("Seeded M3 billing demo data.");
  return { skipped: false as const };
}

// Seeds a demo daycare, its rooms/staff, two children with a parent, an invite,
// and a small set of daily-loop records so the MVP is immediately explorable.
// Runs against whichever engine is active (Supabase Postgres or local SQLite).
export async function seedDemo() {
  const existing = await queryGet("SELECT COUNT(*) AS c FROM institute");
  if ((existing?.c as number) > 0) {
    console.log("Seed skipped: data already present.");
    return;
  }

  const institute = await store.seedInstitute({
    name: "Sunshine Daycare",
    primaryColor: "#8B5CF6",
    accentColor: "#F59E0B",
    font: "Nunito",
    openingHours: {
      mon: "07:00-18:00",
      tue: "07:00-18:00",
      wed: "07:00-18:00",
      thu: "07:00-18:00",
      fri: "07:00-18:00",
    },
  });
  const iid = institute.id as string;

  const roomA = await store.createRoom(iid, "Toddlers", 12);
  const roomB = await store.createRoom(iid, "Preschool", 16);

  await store.createStaff({
    instituteId: iid,
    fullName: "Maria Lopez",
    role: "admin",
    roomIds: [roomA.id as string, roomB.id as string],
  });

  // Admin portal account
  await createAccount({
    email: "admin@sunshinedaycare.test",
    password: "kiddy-admin",
    fullName: "Maria Lopez",
    role: "owner",
  });

  const childA = await store.createChild({
    instituteId: iid,
    firstName: "Ella",
    lastName: "Nguyen",
    dob: "2021-04-12",
    roomId: roomA.id as string,
    allergies: "Peanuts",
  });
  const childB = await store.createChild({
    instituteId: iid,
    firstName: "Leo",
    lastName: "Nguyen",
    dob: "2020-08-03",
    roomId: roomB.id as string,
  });

  await store.addContact({
    childId: childA.id as string,
    fullName: "Grace Nguyen",
    relationship: "Mother",
    phone: "+1 555 0100",
    email: "grace@example.test",
    isPickup: true,
    isEmergency: true,
  });

  // Parent account linked to both children
  const parent = await createAccount({
    email: "parent@example.test",
    password: "kiddy-parent",
    fullName: "Grace Nguyen",
    role: "parent",
    pin: "1234",
  });
  await store.linkFamily(parent.id as string, childA.id as string);
  await store.linkFamily(parent.id as string, childB.id as string);

  await store.createInvite(iid, childA.id as string, "parent@example.test", "SUNSHINE-1234");

  const today = new Date().toISOString().slice(0, 10);
  const adminAcc = (await queryGet("SELECT id FROM account WHERE role='owner'")) as { id: string };

  await store.upsertDailyReport({
    childId: childA.id as string,
    reportDate: today,
    summary: "Ella had a great day! Played in the sandbox and did a puzzle.",
    observation: "Working hard on sharing with friends.",
    mood: "happy",
    meal: JSON.stringify({ breakfast: "Oatmeal", lunch: "Chicken & rice", snack: "Apple" }),
    sleep: JSON.stringify({ naps: ["12:30-14:00"], total: "1h30m" }),
    diaper: "3 changes",
    accountId: adminAcc.id,
  });

  await store.createNewsfeedPost({
    instituteId: iid,
    accountId: adminAcc.id,
    body: "Welcome to Sunshine Daycare! This week we're exploring shapes and colors.",
    tagChildIds: [childA.id as string, childB.id as string],
  });

  await store.createConsent({ instituteId: iid, title: "Outdoor play permission", body: "May your child play in the outdoor yard?", childId: childA.id as string });

  // M3 billing demo data: a monthly plan per child and one open invoice so the
  // parent billing page has real transactions to show.
  await store.upsertChildPlan({
    instituteId: iid,
    childId: childA.id as string,
    planName: "Full-time toddler",
    amountCents: 120000,
    billingPeriod: "monthly",
    updatedByAccountId: adminAcc.id,
  });
  await store.upsertChildPlan({
    instituteId: iid,
    childId: childB.id as string,
    planName: "Preschool half-day",
    amountCents: 95000,
    billingPeriod: "monthly",
    updatedByAccountId: adminAcc.id,
  });
  await store.createInvoice({
    instituteId: iid,
    childId: childA.id as string,
    description: "September tuition",
    amountCents: 120000,
    dueDate: today.slice(0, 8) + "01",
    createdByAccountId: adminAcc.id,
  });
  await store.createInvoice({
    instituteId: iid,
    childId: childB.id as string,
    description: "September tuition",
    amountCents: 95000,
    dueDate: today.slice(0, 8) + "01",
    createdByAccountId: adminAcc.id,
  });
  await store.savePaymentMethod({
    accountId: parent.id as string,
    label: "Main credit card",
    provider: "Credit card",
    last4: "4242",
    isDefault: true,
  });

  console.log("Seeded demo daycare:", iid);
}

// Run on `tsx lib/seed.ts` (npm run db:init). `require.main === module` guards
// against running when this module is imported by the app/server.
if (typeof require !== "undefined" && require.main === module) {
  ensureSeededWrapper();
}

async function ensureSeededWrapper() {
  const { ensureSchema } = await import("./db");
  await ensureSchema();
  await seedDemo();
  process.exit(0);
}