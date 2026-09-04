import { queryGet } from "./db";
import * as store from "./store";
import { createAccount } from "./auth";

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