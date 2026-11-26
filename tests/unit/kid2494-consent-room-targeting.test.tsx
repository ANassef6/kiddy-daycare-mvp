// KID-2494: consents can target whole classrooms (and/or specific children)
// instead of picking every child one by one. The pins are behavioural: they
// drive the real server action and inspect the consent_request rows, so a
// classroom audience is verified against the roster at send time rather than
// against the JSX.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  headers: () => new Headers(),
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

async function sendConsent(fields: { title: string; roomIds?: string[]; childIds?: string[] }): Promise<string> {
  const form = new FormData();
  form.set("title", fields.title);
  form.set("body", "Please review.");
  for (const roomId of fields.roomIds ?? []) form.append("recipientRoomIds", roomId);
  for (const childId of fields.childIds ?? []) form.append("childIds", childId);
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
  });

  it("includes a child enrolled in the room before submit time", async () => {
    const late = await store.createChild({ instituteId: iid, firstName: "Late", lastName: "Joiner", roomId: roomA });
    await sendConsent({ title: "KID2494 Late enrollment", roomIds: [roomA] });
    const rows = await consentRows("KID2494 Late enrollment");
    expect(rows.map((r) => String(r.child_id))).toContain(String(late.id));
  });

  it("unions a classroom and specific children without duplicates", async () => {
    await store.createChild({ instituteId: iid, firstName: "Mila", lastName: "Toddler", roomId: roomA });
    const ella = await childIdByName("Ella");
    const leo = await childIdByName("Leo");
    // Ella is already in the picked room; Leo is in the other room. Both the
    // classroom roster and the explicit pick must contribute exactly once.
    await sendConsent({ title: "KID2494 Union", roomIds: [roomA], childIds: [ella, leo] });
    const rows = await consentRows("KID2494 Union");
    const ids = rows.map((r) => String(r.child_id));
    expect(ids.filter((id) => id === ella)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(leo);
    expect(ids).toHaveLength(3);
  });

  it("keeps per-child response tracking", async () => {
    await store.createChild({ instituteId: iid, firstName: "Mila", lastName: "Toddler", roomId: roomA });
    await sendConsent({ title: "KID2494 Responses", roomIds: [roomA] });
    const rows = await consentRows("KID2494 Responses");
    const ellaRow = rows.find((r) => r.child_first_name === "Ella")!;
    await store.respondConsent(String(ellaRow.id), "approved");

    const after = await consentRows("KID2494 Responses");
    expect(after.find((r) => r.child_first_name === "Ella")!.status).toBe("approved");
    expect(after.find((r) => r.child_first_name === "Mila")!.status).toBe("pending");
  });

  it("keeps all / general as one request with no child", async () => {
    await sendConsent({ title: "KID2494 General" });
    const rows = await consentRows("KID2494 General");
    expect(rows).toHaveLength(1);
    expect(rows[0].child_id).toBeNull();
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
});

describe("KID-2494 audience labels", () => {
  const rooms = () => [
    { id: roomA, name: "Toddlers" },
    { id: roomB, name: "Preschool" },
  ];

  it("renders the EN classroom and child options", () => {
    const html = renderToStaticMarkup(
      <ConsentAudiencePicker
        dict={getDictionary("en")}
        defaultOpen
        role="admin"
        assignedRoomIds={[]}
        rooms={rooms()}
        childOptions={[]}
      />
    );
    expect(html).toContain("All / general");
    expect(html).toContain("Classrooms");
    expect(html).toContain("Specific children (optional)");
    expect(html).toContain("Search children…");
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
        childOptions={[]}
      />
    );
    expect(html).toContain("الكل / عام");
    expect(html).toContain("الفصول");
    expect(html).toContain("أطفال محددون (اختياري)");
    expect(html).toContain("Toddlers");
    expect(html).not.toContain("Preschool");
  });
});
