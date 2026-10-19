import { queryGet, queryRun } from "./db";
import * as store from "./store";
import { createAccount } from "./auth";
import { ensureCurriculumSeeded, ageGroupForDob } from "./curriculum";
import { PLATFORM_OPERATOR_LEGACY_ROLE, PLATFORM_OPERATOR_ROLE } from "./platform";

// KID-199.4r: documented platform operator credentials. Both are overridable
// via env; production bootstraps access with PLATFORM_ADMIN_EMAIL instead
// (see docs/PLATFORM_BOOTSTRAP.md). The account row carries the internal
// platform sentinel (`lib/platform.ts`) — it is NOT a daycare role.
const PLATFORM_OPERATOR_EMAIL = process.env.PLATFORM_ADMIN_EMAIL ?? "superadmin@kiddy.test";
const PLATFORM_OPERATOR_PASSWORD = process.env.PLATFORM_OPERATOR_PASSWORD ?? "kiddy-superadmin";

// KID-199.4r: idempotently make the operator identity real. Any KID-199.3
// `superadmin` rows are renamed to the internal sentinel (migration 0023 does
// the same at the SQL layer), and the allowlisted email gets the account.
export async function ensurePlatformOperator(opts?: {
  /** Production bootstrap: only act when the allowlist is explicit. */
  requireEnv?: boolean;
}) {
  if (opts?.requireEnv) {
    // KID-199.4r security rail: never mint the demo operator credentials
    // into a server this code does not own. When PLATFORM_ADMIN_EMAIL (or
    // the legacy SUPERADMIN_EMAIL) is not set, there is nothing to
    // bootstrap — renting the documented demo password onto a public
    // deployment would hand /platform to anyone.
    if (!process.env.PLATFORM_ADMIN_EMAIL?.trim() && !process.env.SUPERADMIN_EMAIL?.trim()) {
      console.log("Platform operator bootstrap skipped: no PLATFORM_ADMIN_EMAIL set.");
      return;
    }
  }
  // One-time data fix for datasets that existed before the rework.
  const legacy = await queryGet(
    "SELECT COUNT(*) AS c FROM account WHERE role = 'superadmin'"
  );
  if (Number(legacy?.c ?? 0) > 0) {
    await queryRun(
      `UPDATE account SET role = ? WHERE role = ?`,
      PLATFORM_OPERATOR_ROLE,
      PLATFORM_OPERATOR_LEGACY_ROLE
    );
    console.log("Renamed the legacy superadmin accounts to the platform operator sentinel");
  }
  const existing = await queryGet(
    "SELECT id, role FROM account WHERE lower(trim(email)) = lower(trim(?))",
    PLATFORM_OPERATOR_EMAIL
  );
  if (!existing) {
    // createAccount() refuses daycare-facing role values; the internal
    // platform sentinel is on its server-internal allowlist, so only seeded/
    // bootstrap code can mint an operator account — no UI or API can.
    await createAccount({
      email: PLATFORM_OPERATOR_EMAIL,
      password: PLATFORM_OPERATOR_PASSWORD,
      fullName: "Platform Operator",
      role: PLATFORM_OPERATOR_ROLE,
    });
    console.log(`Seeded platform operator account: ${PLATFORM_OPERATOR_EMAIL}`);
  } else if (String(existing.role ?? "") !== PLATFORM_OPERATOR_ROLE) {
    await queryRun(
      "UPDATE account SET role = ? WHERE id = ?",
      PLATFORM_OPERATOR_ROLE,
      existing.id
    );
    console.log(`Granted the platform sentinel role to ${PLATFORM_OPERATOR_EMAIL}`);
  }
}

// Seeds a demo daycare, its rooms/staff, two children with a parent, an invite,
// and a small set of daily-loop records so the MVP is immediately explorable.
// Runs against whichever engine is active (Supabase Postgres or local SQLite).
export async function seedDemo() {
  // KID-199.3: ensure the platform operator account exists even when the demo
  // daycare is already seeded (skip path below).
  await ensurePlatformOperator();

  const existing = await queryGet("SELECT COUNT(*) AS c FROM institute");
  if ((existing?.c as number) > 0) {
    console.log("Seed skipped: data already present.");
    return;
  }

  const institute = await store.seedInstitute({
    name: "Sunshine Daycare",    primaryColor: "#8B5CF6",
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

  // Seed the starter curriculum (Egyptian KG framework) so the learning
  // cascade works end to end. The founder's real curriculum from
  // /home/nassef/Documents/replica/curri replaces it by swapping
  // data/curriculum-eg-kg.json — no code changes.
  await ensureCurriculumSeeded();

  const roomA = await store.createRoom(iid, "Toddlers", 12);
  const roomB = await store.createRoom(iid, "Preschool", 16);

  const adminStaff = await store.createStaff({
    instituteId: iid,
    fullName: "Maria Lopez",
    role: "admin",
    roomIds: [roomA.id as string, roomB.id as string],
  });

  // Admin portal account
  const adminAccount = await createAccount({
    email: "admin@sunshinedaycare.test",
    password: "kiddy-admin",
    fullName: "Maria Lopez",
    role: "owner",
  });

  // KID-171 (D2): link the login to the staff record it belongs to. Without
  // `account.staff_id` the seeded owner was a login with no staff record, and
  // `classroomStaffForParent` — which needs account → staff → staff_room — found
  // nothing, so no parent in a seeded centre could message the daycare at all.
  // Production carries the same shape (every staff row on /portal/staff read
  // "No login yet"), so the seeded centre was the reference for a deployment
  // that could not message.
  await queryRun(
    "UPDATE account SET staff_id = ? WHERE id = ?",
    adminStaff.id as string,
    adminAccount.id as string
  );

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
    relationship: "parent",
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

  // ---- T5 / M5 extra kept areas: demo data ----
  await store.createEvent({
    instituteId: iid,
    title: "In-house field trip: fire station visit",
    eventDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    startTime: "09:30",
    endTime: "11:00",
    location: "Main branch",
    description: "Firefighters show their truck and gear. Please dress your child in comfortable clothes.",
    accountId: adminAcc.id,
  });
  await store.createEvent({
    instituteId: iid,
    title: "Spring photo day",
    eventDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    location: "Multipurpose room",
    description: "Individual and group photos. Prints stay in the parent drive.",
    accountId: adminAcc.id,
  });
  await store.addMedia({
    instituteId: iid,
    url: "https://storage.googleapis.com/coverr-main/mp4/Mt_Baker.mp4",
    kind: "video",
    caption: "Morning outdoor play in the sunshine",
    childId: childA.id as string,
    accountId: adminAcc.id,
  });
  await store.createForm({
    instituteId: iid,
    kind: "survey",
    title: "Would you like a parent-teacher conference?",
    description: "Pick a preference and we will follow up.",
    fieldsJson: JSON.stringify([
      { id: "f0", label: "Your availability", type: "select", options: ["Weekday morning", "Weekday afternoon", "Weekend"], required: true },
      { id: "f1", label: "Questions or topics to discuss", type: "textarea", required: false },
    ]),
    accountId: adminAcc.id,
  });
  await store.createForm({
    instituteId: iid,
    kind: "list",
    title: "Photo day permission list",
    description: "Tick the box to approve photos of your child.",
    fieldsJson: JSON.stringify([{ id: "f0", label: "I allow photos of my child", type: "checkbox", required: true }]),
    accountId: adminAcc.id,
  });
  await store.createTag(iid, "Allergies", "#F43F5E");
  await store.createTag(iid, "New family", "#8B5CF6");
  await store.createTag(iid, "Full-time", "#10B981");
  const tags = await store.listTags(iid);
  await store.setChildTags(childA.id as string, [tags[0].id as string, tags[2].id as string]);
  await store.addDriveFile({
    instituteId: iid,
    filename: "Sunshine Daycare Parent Handbook 2026.pdf",
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    kind: "pdf",
    sizeBytes: 128000,
    description: "Opening hours, policies, and what to bring.",
    accountId: adminAcc.id,
  });
  await store.addDriveFile({
    instituteId: iid,
    filename: "Ella — immunizations.pdf",
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    kind: "pdf",
    childId: childA.id as string,
    description: "Ella's immunization record for your records.",
    accountId: adminAcc.id,
  });

  // Link the sample observations to curriculum learning points and milestones
  // so the parent view shows the full cascade fields. Age bands are derived
  // from each child's date of birth.
  const childAGroup = ageGroupForDob(childA.dob as string);
  const childBGroup = ageGroupForDob(childB.dob as string);
  const physicalArea = await queryGet("SELECT id FROM curriculum_area WHERE name = 'Physical Development & Health'");
  const grossMotorPoint = physicalArea
    ? await queryGet("SELECT lp.id FROM curriculum_learning_point lp WHERE lp.area_id = ? AND lp.name = 'Gross motor'", physicalArea.id)
    : undefined;
  const grossMotorMilestone = grossMotorPoint
    ? await queryGet("SELECT m.id FROM curriculum_milestone m WHERE m.learning_point_id = ? AND m.age_group = ? AND m.name = 'Runs, jumps, skips and climbs with control'", grossMotorPoint.id, childAGroup)
    : undefined;
  const selfCarePoint = physicalArea
    ? await queryGet("SELECT lp.id FROM curriculum_learning_point lp WHERE lp.area_id = ? AND lp.name = 'Self-care & hygiene'", physicalArea.id)
    : undefined;
  const selfCareMilestone = selfCarePoint
    ? await queryGet("SELECT m.id FROM curriculum_milestone m WHERE m.learning_point_id = ? AND m.age_group = ? AND m.name = 'Dresses and undresses independently'", selfCarePoint.id, childBGroup)
    : undefined;

  await store.createObservation({
    instituteId: iid,
    childId: childA.id as string,
    accountId: adminAcc.id,
    kind: "milestone",
    title: "Confident on the climbing frame",
    body: "Ella ran, jumped and climbed the frame in the garden today — full of energy and balance.",
    ageGroup: childAGroup,
    learningPointId: grossMotorPoint ? (grossMotorPoint.id as string) : undefined,
    milestoneId: grossMotorMilestone ? (grossMotorMilestone.id as string) : undefined,
    recordedAt: today,
  });
  await store.createObservation({
    instituteId: iid,
    childId: childB.id as string,
    accountId: adminAcc.id,
    kind: "goal",
    title: "Building independence",
    body: "Leo is working on dressing himself after nap time — buttons and fasteners are the focus.",
    ageGroup: childBGroup,
    learningPointId: selfCarePoint ? (selfCarePoint.id as string) : undefined,
    milestoneId: selfCareMilestone ? (selfCareMilestone.id as string) : undefined,
    recordedAt: today,
  });
  await store.createSupportTicket({
    instituteId: iid,
    accountId: parent.id as string,
    subject: "Pickup change for Friday",
    body: "My mother-in-law will pick Ella up on Friday. Should be on the pickup list.",
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