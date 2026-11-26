// KID-2494: consents can target whole classrooms instead of picking every
// child one by one. The pins are behavioural: they drive the real server
// action and inspect the consent_request rows, so a classroom audience is
// verified against the roster at send time rather than against the JSX. The
// founder later removed per-child picking and asked for per-recipient response
// tracking, so the detail view and its data are covered here too.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  headers: () =>
    new Headers(
      mockState.cookies.kiddy_sess ? { cookie: `kiddy_sess=${mockState.cookies.kiddy_sess}` } : {}
    ),
  cookies: () => ({
    get: (name: string) => (mockState.cookies[name] ? { name, value: mockState.cookies[name] } : undefined),
    set: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
    err.digest = `NEXT_REDIRECT;replace;${url};`;
    throw err;
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import * as store from "@/lib/store";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";
import ConsentAudiencePicker from "@/components/ConsentAudiencePicker";
import { seedFixture } from "../helpers";

let iid: string;
let roomA: string;
let roomB: string;
let adminAcc: string;

function signInAs(accountId: string, role: string, email: string): void {
  mockState.cookies = {
    kiddy_sess: createSessionToken({ accountId, role, email, emailConfirmed: true }),
  };
}

async function redirectTargetFor(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (err) {
    const m = /NEXT_REDIRECT;replace;([^;]+);/.exec(String((err as Error & { digest?: string })?.digest ?? ""));
    if (m) return m[1];
    throw err;
  }
}

async function sendConsent(fields: { title: string; roomIds?: string[] }): Promise<string> {
  const form = new FormData();
  form.set("title", fields.title);
  form.set("body", "Please review.");
  for (const roomId of fields.roomIds ?? []) form.append("recipientRoomIds", roomId);
  const { createConsentAction } = await import("@/lib/actions");
  return redirectTargetFor(() => createConsentAction(form));
}

async function consentRows(title: string) {
  return queryAll(
    `SELECT cr.*, c.first_name AS child_first_name
     FROM consent_request cr LEFT JOIN child c ON c.id = cr.child_id
     WHERE cr.title = ? ORDER BY c.first_name`,
    title
  );
}

async function childIdByName(firstName: string): Promise<string> {
  return String((await queryGet("SELECT id FROM child WHERE first_name = ? LIMIT 1", firstName))!.id);
}

async function parentAccountId(): Promise<string> {
  return String((await queryGet("SELECT id FROM account WHERE email = 'parent@example.test' LIMIT 1"))!.id);
}

beforeEach(async () => {
  mockState.cookies = {};
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
  const staff = await store.createStaff({ instituteId: iid, fullName: "KID2494 Admin", role: "admin", roomIds: [] });
  adminAcc = String(
    (await createAccount({ email: "kid2494-admin@example.com", password: "x", fullName: "KID2494 Admin", role: "admin" })).id
  );
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), adminAcc);
  signInAs(adminAcc, "admin", "kid2494-admin@example.com");
});

describe("KID-2494 classroom consent targeting", () => {
  it("sends one consent row to every child in the room and none in another room", async () => {
    const extra = await store.createChild({ instituteId: iid, firstName: "Mila", lastName: "Toddler", roomId: roomA });
    const target = await sendConsent({ title: "KID2494 Toddlers trip", roomIds: [roomA] });
    expect(target).toBe("/portal/consents");

    const rows = await consentRows("KID2494 Toddlers trip");
    const ids = rows.map((r) => String(r.child_id)).sort();
    expect(ids).toEqual([extra.id as string, await childIdByName("Ella")].sort());
    expect(ids).not.toContain(await childIdByName("Leo"));
    expect(new Set(rows.map((r) => String(r.batch_id))).size).toBe(1);
  });

  it("lets the owner target any classroom, with the same scope as an admin", async () => {
    const ownerAcc = String(
      (await createAccount({ email: "kid2494-owner@example.com", password: "x", fullName: "KID2494 Owner", role: "owner" })).id
    );
    signInAs(ownerAcc, "owner", "kid2494-owner@example.com");

    const target = await sendConsent({ title: "KID2494 Owner room", roomIds: [roomB] });
    expect(target).toBe("/portal/consents");
    const ids = (await consentRows("KID2494 Owner room")).map((r) => String(r.child_id));
    expect(ids).toContain(await childIdByName("Leo"));
    expect(ids).not.toContain(await childIdByName("Ella"));
  });

  it("includes a child enrolled in the room before submit time", async () => {
    const late = await store.createChild({ instituteId: iid, firstName: "Late", lastName: "Joiner", roomId: roomA });
    await sendConsent({ title: "KID2494 Late enrollment", roomIds: [roomA] });
    const rows = await consentRows("KID2494 Late enrollment");
    expect(rows.map((r) => String(r.child_id))).toContain(String(late.id));
  });

  it("sends All / general to every visible child as per-child rows", async () => {
    await sendConsent({ title: "KID2494 General" });
    const rows = await consentRows("KID2494 General");
    const ids = rows.map((r) => String(r.child_id));
    expect(ids).toContain(await childIdByName("Ella"));
    expect(ids).toContain(await childIdByName("Leo"));
    expect(rows.every((r) => r.child_id !== null)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("records who answered and when, and keeps the batch together", async () => {
    await store.createChild({ instituteId: iid, firstName: "Mila", lastName: "Toddler", roomId: roomA });
    await sendConsent({ title: "KID2494 Responses", roomIds: [roomA] });
    const rows = await consentRows("KID2494 Responses");
    const ellaRow = rows.find((r) => r.child_first_name === "Ella")!;
    const parent = await parentAccountId();
    await store.respondConsent(String(ellaRow.id), "approved", parent);

    const after = await consentRows("KID2494 Responses");
    const ellaAfter = after.find((r) => r.child_first_name === "Ella")!;
    expect(ellaAfter.status).toBe("approved");
    expect(ellaAfter.responded_at).toBeTruthy();
    expect(String(ellaAfter.responded_by_account_id)).toBe(parent);
    expect(after.find((r) => r.child_first_name === "Mila")!.status).toBe("pending");

    const batchId = String(ellaRow.batch_id);
    const batch = await store.getConsentBatch(iid, batchId);
    expect(Number(batch!.total)).toBe(2);
    expect(Number(batch!.approved)).toBe(1);
    expect(Number(batch!.pending)).toBe(1);

    const recipients = await store.listConsentRecipients(iid, batchId);
    const ellaRecipient = recipients.find((r) => r.first_name === "Ella")!;
    expect(String(ellaRecipient.parent_names)).toContain("Grace Nguyen");
    expect(String(ellaRecipient.responded_by_name)).toBe("Grace Nguyen");
    expect(String(ellaRecipient.room_name)).toBe("Toddlers");
  });

  it("refuses a classroom outside a teacher's assignment without falling back to general", async () => {
    const teacherStaff = await store.createStaff({ instituteId: iid, fullName: "KID2494 Teacher", role: "carer", roomIds: [roomA] });
    const teacherAcc = String(
      (await createAccount({ email: "kid2494-teacher@example.com", password: "x", fullName: "KID2494 Teacher", role: "staff" })).id
    );
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(teacherStaff.id), teacherAcc);
    signInAs(teacherAcc, "staff", "kid2494-teacher@example.com");

    const target = await sendConsent({ title: "KID2494 Forged room", roomIds: [roomB] });
    expect(target).toBe("/portal/consents?error=audience");
    expect(await consentRows("KID2494 Forged room")).toHaveLength(0);
  });

  it("lets a teacher target an assigned classroom", async () => {
    const teacherStaff = await store.createStaff({ instituteId: iid, fullName: "KID2494 Room Teacher", role: "carer", roomIds: [roomA] });
    const teacherAcc = String(
      (await createAccount({ email: "kid2494-room-teacher@example.com", password: "x", fullName: "KID2494 Room Teacher", role: "staff" })).id
    );
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(teacherStaff.id), teacherAcc);
    signInAs(teacherAcc, "staff", "kid2494-room-teacher@example.com");

    await sendConsent({ title: "KID2494 Teacher room", roomIds: [roomA] });
    const ids = (await consentRows("KID2494 Teacher room")).map((r) => String(r.child_id));
    expect(ids).toContain(await childIdByName("Ella"));
    expect(ids).not.toContain(await childIdByName("Leo"));
  });

  it("keeps All / general inside a teacher's assigned rooms", async () => {
    const teacherStaff = await store.createStaff({ instituteId: iid, fullName: "KID2494 All Teacher", role: "carer", roomIds: [roomA] });
    const teacherAcc = String(
      (await createAccount({ email: "kid2494-all-teacher@example.com", password: "x", fullName: "KID2494 All Teacher", role: "staff" })).id
    );
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(teacherStaff.id), teacherAcc);
    signInAs(teacherAcc, "staff", "kid2494-all-teacher@example.com");

    await sendConsent({ title: "KID2494 Teacher all" });
    const ids = (await consentRows("KID2494 Teacher all")).map((r) => String(r.child_id));
    expect(ids).toContain(await childIdByName("Ella"));
    expect(ids).not.toContain(await childIdByName("Leo"));
  });
});

describe("KID-2494 recipient list", () => {
  it("lists one row per send with counts and a recipient link", async () => {
    await store.createChild({ instituteId: iid, firstName: "Mila", lastName: "Toddler", roomId: roomA });
    await sendConsent({ title: "KID2494 List", roomIds: [roomA] });
    const { default: Page } = await import("@/app/portal/consents/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("KID2494 List");
    expect(html).toContain("Toddlers");
    expect(html).toContain("0 answered, 2 pending");
    expect(html.match(/View recipients/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain("/portal/consents/");
  });

  it("shows every recipient, the parent, the response and the responder in EN", async () => {
    await store.createChild({ instituteId: iid, firstName: "Mila", lastName: "Toddler", roomId: roomA });
    await sendConsent({ title: "KID2494 Detail EN", roomIds: [roomA] });
    const rows = await consentRows("KID2494 Detail EN");
    const ellaRow = rows.find((r) => r.child_first_name === "Ella")!;
    await store.respondConsent(String(ellaRow.id), "approved", await parentAccountId());
    const { default: Page } = await import("@/app/portal/consents/[id]/page");
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: String(ellaRow.batch_id) }) }));

    expect(html).toContain("KID2494 Detail EN");
    expect(html).toContain("Recipients");
    expect(html).toContain("Toddlers");
    expect(html).toContain("Ella");
    expect(html).toContain("Grace Nguyen");
    expect(html).toContain("Approved");
    expect(html).toContain("Pending");
    expect(html).toContain("Answered by");
  });

  it("shows the Arabic recipient labels", async () => {
    await sendConsent({ title: "KID2494 Detail AR", roomIds: [roomA] });
    const rows = await consentRows("KID2494 Detail AR");
    await queryRun("UPDATE account SET language = 'ar' WHERE id = ?", adminAcc);
    const { default: Page } = await import("@/app/portal/consents/[id]/page");
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: String(rows[0].batch_id) }) }));

    expect(html).toContain("المستلمون");
    expect(html).toContain("ولي الأمر");
    expect(html).toContain("تم الرد بواسطة");
    expect(html).toContain("معلّق");
  });
});

describe("KID-2494 audience labels", () => {
  const rooms = () => [
    { id: roomA, name: "Toddlers" },
    { id: roomB, name: "Preschool" },
  ];

  it("renders the EN classroom options and no child picker", () => {
    const html = renderToStaticMarkup(
      <ConsentAudiencePicker
        dict={getDictionary("en")}
        defaultOpen
        role="admin"
        assignedRoomIds={[]}
        rooms={rooms()}
      />
    );
    expect(html).toContain("All / general");
    expect(html).toContain("Classrooms");
    expect(html).toContain("Toddlers");
    expect(html).toContain("Preschool");
    expect(html).not.toContain("Search children");
    expect(html).not.toContain("Specific children");
  });

  it("shows every room to the owner, not only assigned rooms", () => {
    const html = renderToStaticMarkup(
      <ConsentAudiencePicker
        dict={getDictionary("en")}
        defaultOpen
        role="owner"
        assignedRoomIds={[]}
        rooms={rooms()}
      />
    );
    expect(html).toContain("Toddlers");
    expect(html).toContain("Preschool");
  });

  it("renders the AR labels and hides rooms outside a teacher's assignment", () => {
    const html = renderToStaticMarkup(
      <ConsentAudiencePicker
        dict={getDictionary("ar")}
        defaultOpen
        role="staff"
        assignedRoomIds={[roomA]}
        rooms={rooms()}
      />
    );
    expect(html).toContain("الكل / عام");
    expect(html).toContain("الفصول");
    expect(html).toContain("Toddlers");
    expect(html).not.toContain("Preschool");
    expect(html).not.toContain("أطفال محددون");
  });
});
