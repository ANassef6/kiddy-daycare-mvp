// KID-2485: surveys now carry a recipient audience.
//
// These tests drive the real createFormAction (only the session cookie is
// mocked) and render the real pages, so the pins cover what a staff member can
// actually save, what the server stores, what the portal shows, and which
// families see a targeted survey.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  headers: () => {
    const headers = new Headers();
    const token = mockState.cookies.kiddy_sess;
    if (token) headers.set("cookie", `kiddy_sess=${token}`);
    return headers;
  },
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
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import * as store from "@/lib/store";
import { createAccount, createSessionToken, setAccountLanguage } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { getDictionary, tr } from "@/lib/i18n";
import { describeSurveyAudience, surveyVisibleToChildren } from "@/lib/survey-audience";
import { seedFixture } from "../helpers";

let iid: string;
let roomA: string;
let roomB: string;
let ellaId: string;
let leoId: string;
let ownerId: string;

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

async function surveyCount(): Promise<number> {
  return Number((await queryGet("SELECT COUNT(*) AS n FROM form_template WHERE kind = 'survey'"))!.n);
}

function surveyForm(overrides: Record<string, string | string[]> = {}): FormData {
  const form = new FormData();
  form.set("kind", "survey");
  form.set("title", "KID2485 Survey");
  form.set("returnTo", "/portal/surveys");
  for (const [key, value] of Object.entries(overrides)) {
    if (Array.isArray(value)) value.forEach((v) => form.append(key, v));
    else form.set(key, value);
  }
  return form;
}

async function staffAccountFor(email: string, roomIds: string[]) {
  const staff = await store.createStaff({ instituteId: iid, fullName: email, role: "staff", roomIds });
  const account = await createAccount({ email, password: "x", fullName: email, role: "staff" });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(account.id));
  return String(account.id);
}

beforeEach(async () => {
  mockState.cookies = {};
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
  ellaId = String((await queryGet("SELECT id FROM child WHERE first_name = 'Ella'"))!.id);
  leoId = String((await queryGet("SELECT id FROM child WHERE first_name = 'Leo'"))!.id);
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
  signInAs(ownerId, "owner", "trois4ever+admin@gmail.com");
});

describe("KID-2485 survey recipient rules", () => {
  it("refuses a survey with no recipient or classroom channel and writes nothing", async () => {
    const before = await surveyCount();
    const { createFormAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => createFormAction(surveyForm()));
    expect(target).toBe("/portal/surveys?error=form-recipients");
    expect(await surveyCount()).toBe(before);
  });

  it("stores the resolved whole-center audience for an admin", async () => {
    const { createFormAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      createFormAction(surveyForm({ recipientChannel: "center", title: "KID2485 Everyone" }))
    );
    expect(target).toBe("/portal/surveys");
    const row = await queryGet("SELECT * FROM form_template WHERE title = 'KID2485 Everyone'");
    expect(row?.audience_channel).toBe("center");
    expect(JSON.parse(String(row?.audience_child_ids)).sort()).toEqual([ellaId, leoId].sort());
  });

  it("refuses a forged Everyone channel for staff", async () => {
    const staffId = await staffAccountFor("kid2485-staff-forge@example.com", [roomA]);
    signInAs(staffId, "staff", "kid2485-staff-forge@example.com");
    const before = await surveyCount();
    const { createFormAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      createFormAction(surveyForm({ recipientChannel: "center", title: "KID2485 Forged" }))
    );
    expect(target).toBe("/portal/surveys?error=form-recipients");
    expect(await surveyCount()).toBe(before);
  });

  it("narrows a staff classroom pick to assigned rooms and their children", async () => {
    const staffId = await staffAccountFor("kid2485-staff-room@example.com", [roomA]);
    signInAs(staffId, "staff", "kid2485-staff-room@example.com");
    const { createFormAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      createFormAction(
        surveyForm({
          recipientChannel: "rooms",
          recipientRoomIds: [roomA, roomB],
          title: "KID2485 Toddlers",
        })
      )
    );
    expect(target).toBe("/portal/surveys");
    const row = await queryGet("SELECT * FROM form_template WHERE title = 'KID2485 Toddlers'");
    expect(row?.audience_channel).toBe("rooms");
    expect(JSON.parse(String(row?.audience_room_ids))).toEqual([roomA]);
    expect(JSON.parse(String(row?.audience_child_ids))).toEqual([ellaId]);
  });

  it("drops an out-of-scope child pick for staff", async () => {
    const staffId = await staffAccountFor("kid2485-staff-child@example.com", [roomA]);
    signInAs(staffId, "staff", "kid2485-staff-child@example.com");
    const before = await surveyCount();
    const { createFormAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      createFormAction(surveyForm({ childIds: [leoId], title: "KID2485 Leo" }))
    );
    expect(target).toBe("/portal/surveys?error=form-recipients");
    expect(await surveyCount()).toBe(before);
  });

  it("keeps an in-scope child pick and stores it as a children audience", async () => {
    const staffId = await staffAccountFor("kid2485-staff-ella@example.com", [roomA]);
    signInAs(staffId, "staff", "kid2485-staff-ella@example.com");
    const { createFormAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      createFormAction(surveyForm({ childIds: [ellaId, leoId], title: "KID2485 Ella" }))
    );
    expect(target).toBe("/portal/surveys");
    const row = await queryGet("SELECT * FROM form_template WHERE title = 'KID2485 Ella'");
    expect(row?.audience_channel).toBe("children");
    expect(JSON.parse(String(row?.audience_child_ids))).toEqual([ellaId]);
  });
});

describe("KID-2485 audience display and parent visibility", () => {
  it("describes center, classroom, and child audiences in the dict", () => {
    const dict = getDictionary("en");
    const rooms = new Map([[roomA, "Toddlers"], [roomB, "Preschool"]]);
    const children = new Map([[ellaId, "Ella Nguyen"], [leoId, "Leo Nguyen"]]);
    expect(describeSurveyAudience({ audience_channel: "center" }, dict, rooms, children)).toBe(
      tr(dict, "surveysAdmin.audienceEveryone")
    );
    expect(
      describeSurveyAudience({ audience_channel: "rooms", audience_room_ids: JSON.stringify([roomB]) }, dict, rooms, children)
    ).toBe(tr(dict, "surveysAdmin.audienceClassrooms", { rooms: "Preschool" }));
    expect(
      describeSurveyAudience({ audience_channel: "children", audience_child_ids: JSON.stringify([ellaId]) }, dict, rooms, children)
    ).toBe(tr(dict, "surveysAdmin.audienceChildren", { names: "Ella Nguyen" }));
  });

  it("treats legacy rows as visible to all and narrows targeted rows", () => {
    expect(surveyVisibleToChildren({}, [])).toBe(true);
    const targeted = { audience_channel: "rooms", audience_child_ids: JSON.stringify([leoId]) };
    expect(surveyVisibleToChildren(targeted, [ellaId])).toBe(false);
    expect(surveyVisibleToChildren(targeted, [leoId])).toBe(true);
  });

  it("shows the audience on the portal survey card", async () => {
    const { createFormAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      createFormAction(surveyForm({ recipientChannel: "center", title: "KID2485 Listed" }))
    );
    const page = await import("@/app/portal/surveys/page");
    const html = renderToStaticMarkup(
      await page.default({ searchParams: Promise.resolve({}) })
    );
    expect(html).toContain("KID2485 Listed");
    expect(html).toContain(tr(getDictionary("en"), "surveysAdmin.audienceEveryone"));
  });

  it("renders the recipient error in Arabic", async () => {
    await setAccountLanguage(ownerId, "ar");
    const page = await import("@/app/portal/surveys/page");
    const html = renderToStaticMarkup(
      await page.default({ searchParams: Promise.resolve({ error: "form-recipients" }) })
    );
    expect(html).toContain(tr(getDictionary("ar"), "surveysAdmin.recipientsRequired"));
    expect(html).toContain(tr(getDictionary("ar"), "surveysAdmin.recipientsLabel"));
  });

  it("hides a targeted survey from a family outside its audience but keeps legacy ones", async () => {
    const { createFormAction } = await import("@/lib/actions");
    // Legacy survey: no audience columns.
    await store.createForm({ instituteId: iid, kind: "survey", title: "KID2485 Legacy", accountId: ownerId });
    // Targeted to Leo's classroom only.
    await redirectTargetFor(() =>
      createFormAction(
        surveyForm({ recipientChannel: "rooms", recipientRoomIds: [roomB], title: "KID2485 Leo Only" })
      )
    );

    const parent = await createAccount({
      email: "kid2485-ella-parent@example.com",
      password: "x",
      fullName: "Ella Parent",
      role: "parent",
    });
    await store.linkFamily(String(parent.id), ellaId);
    signInAs(String(parent.id), "parent", "kid2485-ella-parent@example.com");

    const page = await import("@/app/child/forms/page");
    const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("KID2485 Legacy");
    expect(html).not.toContain("KID2485 Leo Only");
  });
});
