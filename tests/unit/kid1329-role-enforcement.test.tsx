// KID-1329: role-spec enforcement fixes from the KID-1312 app-layer retest.
//
// Three defects, one suite:
//   1. Pickup child detail over-exposure — /child/[id] rendered the full
//      parent surface (report, statuses, invoices, newsfeed, contacts,
//      incidents) to a pickup link. The spec allows pickup ONLY the child
//      name/photo and today's pickup time control, and /child/newsfeed for
//      pickup surfaced as an HTTP 200 page body instead of a real 404.
//   2. Family messaging spec mismatch — family links could send messages even
//      though the spec hides messaging from family accounts entirely (page,
//      send action, nav and message notifications).
//   3. Missing center toggle — the spec requires one center setting "Allow
//      parents to check in/out" (default on) that hides the parent
//      check-in/out control and rejects the write on web AND mobile while
//      attendance status stays visible.
//
// Every assertion here passes on the fixed tree and fails on the pre-fix code
// (each defect documents the pre-fix behavior it pins against).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryAll, queryGet } from "@/lib/db";
import {
  getInstitute,
  linkFamily,
  sendMessage,
  updateInstitute,
} from "@/lib/store";
import { getDictionary, tr } from "@/lib/i18n";
import { mustGet, seedFixture } from "../helpers";

const SESSION_COOKIE = "kiddy_sess";
const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === SESSION_COOKIE ? { value: sessionCookie.value } : undefined),
    set: () => undefined,
  }),
  headers: () =>
    new Headers(sessionCookie.value ? { cookie: `${SESSION_COOKIE}=${sessionCookie.value}` } : undefined),
}));

// renderToStaticMarkup leaves usePathname() null; ActiveLink needs a string.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, usePathname: () => "/" };
});

import * as store from "@/lib/store";

const en = getDictionary("en");

function label(key: string, vars?: Record<string, string | number>): string {
  return tr(en, key, vars);
}

type NextError = { digest?: unknown; message: string };

async function failureDigest(run: () => Promise<unknown>): Promise<{ kind: "redirect" | "http"; value: string }> {
  try {
    await run();
  } catch (err) {
    const digest = String((err as NextError)?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) {
      return { kind: "redirect", value: digest.split(";")[2] ?? "" };
    }
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) {
      return { kind: "http", value: digest };
    }
    throw err;
  }
  throw new Error("expected the guard to intervene (redirect or 404)");
}

describe("KID-1329 defect 1 — pickup child detail shows only name/photo + pickup time", () => {
  let childA: string;

  beforeEach(async () => {
    await seedFixture();
    childA = String((await queryGet("SELECT id FROM child WHERE first_name = 'Ella'"))!.id);
  });

  afterEach(() => {
    sessionCookie.value = "";
    vi.restoreAllMocks();
  });

  it("renders name/photo and the pickup-time control, and hides every other section", async () => {
    // The pickup account: a parent-role account whose ONLY family link is a
    // 'pickup' link — the seeded parent (access 'parent') is control data.
    const pickup = await createAccount({
      email: "kid1329-pickup@example.test",
      password: "x",
      fullName: "Pablo Pickup",
      role: "parent",
    });
    await linkFamily(String(pickup.id), childA, "pickup");

    const { default: ChildDetailPage } = await import("@/app/child/[id]/page");
    sessionCookie.value = createSessionToken({
      accountId: String(pickup.id),
      role: "parent",
      email: "kid1329-pickup@example.test",
      emailConfirmed: true,
    } as never);

    const markup = renderToStaticMarkup(
      await ChildDetailPage({ params: Promise.resolve({ id: childA }), searchParams: Promise.resolve({}) })
    );

    // Allowed: child name + photo + the check-in/out control (which is
    // today's pickup-time setter) and the "not checked in yet" status badge.
    expect(markup).toContain("Ella");
    expect(markup).toContain(label("attendees.checkIn"));
    expect(markup).toContain(label("attendees.notCheckedInYet"));

    // Hidden: everything else the pre-fix page leaked.
    expect(markup).not.toContain(label("child.todaysUpdates"));
    expect(markup).not.toContain(label("child.todaysReport"));
    expect(markup).not.toContain(label("child.invoicesTitle"));
    expect(markup).not.toContain(label("child.newsfeed"));
    expect(markup).not.toContain(label("child.pickupContacts"));
    expect(markup).not.toContain(label("child.incidentReports"));
    // Seeded data that must NOT be readable through markup:
    expect(markup).not.toContain("sandbox");
    expect(markup).not.toContain("Grace Nguyen");
  });
});

describe("KID-1329 defect 1 — /child/newsfeed for pickup is a real 404", () => {
  it("throws a real HTTP 404 fallback for pickup links", async () => {
    await seedFixture();
    const childId = String((await queryGet("SELECT id FROM child WHERE first_name = 'Ella'"))!.id);
    const pickup = await createAccount({
      email: "kid1329-newsfeed@example.test",
      password: "x",
      fullName: "Nadia Pickup",
      role: "parent",
    });
    await linkFamily(String(pickup.id), childId, "pickup");

    const { default: ParentNewsfeedPage } = await import("@/app/child/newsfeed/page");
    sessionCookie.value = createSessionToken({
      accountId: String(pickup.id),
      role: "parent",
      email: "kid1329-newsfeed@example.test",
      emailConfirmed: true,
    } as never);

    // Pre-fix the pickup denial rode a streaming redirect that surfaced as an
    // HTTP 200 page body; the fix responds with a real 404 (NEXT_HTTP_ERROR_FALLBACK).
    const outcome = await failureDigest(() =>
      ParentNewsfeedPage({ searchParams: Promise.resolve({}) } as never).then(() => null)
    );
    expect(outcome.kind).toBe("http");
    expect(outcome.value).toContain("404");
  });
});

describe("KID-1329 defect 2 — family messaging is hidden", () => {
  let childId: string;
  let familyId: string;
  let staffId: string;

  beforeEach(async () => {
    await seedFixture();
    childId = String((await queryGet("SELECT id FROM child WHERE first_name = 'Ella'"))!.id);
    staffId = String((await mustGet("SELECT id FROM account WHERE role = 'owner'")).id);
    const family = await createAccount({
      email: "kid1329-family@example.test",
      password: "x",
      fullName: "Faiza Family",
      role: "parent",
    });
    await linkFamily(String(family.id), childId, "family");
    familyId = String(family.id);
  });

  afterEach(() => {
    sessionCookie.value = "";
    vi.restoreAllMocks();
  });

  it("server-denies the /child/messages page for a family link (redirect, pre-fix it rendered)", async () => {
    const { default: ParentMessagesPage } = await import("@/app/child/messages/page");
    sessionCookie.value = createSessionToken({
      accountId: familyId,
      role: "parent",
      email: "kid1329-family@example.test",
      emailConfirmed: true,
    } as never);

    const outcome = await failureDigest(() =>
      ParentMessagesPage({ searchParams: Promise.resolve({}) } as never).then(() => null)
    );
    expect(outcome.kind).toBe("redirect");
    expect(outcome.value).toBe("/child");
  });

  it("rejects sendParentMessageAction for a family link (pre-fix it sent)", async () => {
    const { sendParentMessageAction } = await import("@/lib/actions");
    sessionCookie.value = createSessionToken({
      accountId: familyId,
      role: "parent",
      email: "kid1329-family@example.test",
      emailConfirmed: true,
    } as never);

    const fd = new FormData();
    fd.set("recipientId", staffId);
    fd.set("body", "family should never see a composer");
    const outcome = await failureDigest(() => sendParentMessageAction(fd));
    expect(outcome.kind).toBe("redirect");
    expect(outcome.value).toBe("/child?error=role");

    const rows = await queryAll(
      "SELECT id FROM message WHERE sender_account_id = ?",
      familyId
    );
    expect(rows).toEqual([]);
  });

  it("suppresses message notifications to family recipients (and keeps them for real parents)", async () => {
    const parent = await createAccount({
      email: "kid1329-real-parent@example.test",
      password: "x",
      fullName: "Rana Real Parent",
      role: "parent",
    });
    await linkFamily(String(parent.id), childId);

    const fam1 = await sendMessage({
      instituteId: String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id),
      senderAccountId: staffId,
      recipientAccountId: familyId,
      body: "no notification for family",
    });

    const parent1 = await sendMessage({
      instituteId: String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id),
      senderAccountId: staffId,
      recipientAccountId: String(parent.id),
      body: "a real parent still gets the bell",
    });

    const famNote = await queryAll(
      "SELECT id FROM notification WHERE account_id = ? AND activity = 'messages'",
      familyId
    );
    expect(famNote).toEqual([]);

    const parentNote = await queryAll(
      "SELECT id FROM notification WHERE account_id = ? AND activity = 'messages' AND ref = ?",
      String(parent.id),
      `msg-${parent1!.id}`
    );
    expect(parentNote.length).toBe(1);
    // The message row still exists — family is view-silent, not data-cleared.
    expect(fam1).toBeDefined();
  });

  it("hides the Chat nav entry for family links (KID-1329)", async () => {
    sessionCookie.value = createSessionToken({
      accountId: familyId,
      role: "parent",
      email: "kid1329-family@example.test",
      emailConfirmed: true,
    } as never);

    const { default: ChildLayout } = await import("@/app/child/layout");
    const familyMarkup = renderToStaticMarkup(
      await ChildLayout({ children: <p data-testid="page">body</p> })
    );
    expect(familyMarkup).not.toContain(label("nav.chat"));
    expect(familyMarkup).not.toContain("/child/messages");
    // The rest of the family nav survives (view-only read access).
    expect(familyMarkup).toContain(label("nav.newsFeed"));

    // Control: a real parent sees Chat.
    const parent = await createAccount({
      email: "kid1329-nav-parent@example.test",
      password: "x",
      fullName: "Nora Nav Parent",
      role: "parent",
    });
    await linkFamily(String(parent.id), childId);
    sessionCookie.value = createSessionToken({
      accountId: String(parent.id),
      role: "parent",
      email: "kid1329-nav-parent@example.test",
      emailConfirmed: true,
    } as never);
    const parentMarkup = renderToStaticMarkup(
      await ChildLayout({ children: <p data-testid="page">body</p> })
    );
    expect(parentMarkup).toContain(label("nav.chat"));
  });
});

describe("KID-1329 defect 3 — center toggle: Allow parents to check in/out", () => {
  let childId: string;
  let instituteId: string;

  beforeEach(async () => {
    await seedFixture();
    childId = String((await queryGet("SELECT id FROM child WHERE first_name = 'Ella'"))!.id);
    instituteId = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  });

  afterEach(() => {
    sessionCookie.value = "";
    vi.restoreAllMocks();
  });

  function seedSession(accountId: string, email: string): void {
    sessionCookie.value = createSessionToken({
      accountId,
      role: "parent",
      email,
      emailConfirmed: true,
    } as never);
  }

  async function linkedAccount(role: "parent" | "pickup", tag: string): Promise<string> {
    const acc = await createAccount({
      email: `kid1329-${tag}@example.test`,
      password: "x",
      fullName: `K ${tag}`,
      role: "parent",
    });
    await linkFamily(String(acc.id), childId, role);
    return String(acc.id);
  }

  it("migration mirror: the toggle defaults ON for a seeded institute and persists", async () => {
    expect(Number((await getInstitute(instituteId))!.allow_parent_check_inout)).toBe(1);
    await updateInstitute(instituteId, { allow_parent_check_inout: 0 });
    await expect(store.parentCheckInOutAllowed(instituteId)).resolves.toBe(false);
    await updateInstitute(instituteId, { allow_parent_check_inout: 1 });
    await expect(store.parentCheckInOutAllowed(instituteId)).resolves.toBe(true);
  });

  it("web action: rejects a linked parent when the toggle is OFF, with a clear error", async () => {
    await updateInstitute(instituteId, { allow_parent_check_inout: 0 });
    const parentId = await linkedAccount("parent", "toggle-off-parent");
    seedSession(parentId, "kid1329-toggle-off-parent@example.test");

    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "in");
    const res = (await checkInOutAction(fd)) as { error?: string } | undefined;
    expect(res?.error).toContain("turned off parent check-in/out");
    const rows = await queryAll("SELECT id FROM check_in WHERE child_id = ?", childId);
    expect(rows).toEqual([]);
  });

  it("web action: works again when the toggle is back ON (and creates the row)", async () => {
    await updateInstitute(instituteId, { allow_parent_check_inout: 1 });
    const parentId = await linkedAccount("parent", "toggle-on-parent");
    seedSession(parentId, "kid1329-toggle-on-parent@example.test");

    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "in");
    const outcome = await failureDigest(() => checkInOutAction(fd));
    expect(outcome.kind).toBe("redirect");
    expect(outcome.value).toBe(`/child/${childId}`);
    const rows = await queryAll(
      "SELECT id FROM check_in WHERE child_id = ? AND type = 'in'",
      childId
    );
    expect(rows.length).toBe(1);
  });

  it("web action: pickup keeps its pickup-time registration even when the toggle is OFF", async () => {
    await updateInstitute(instituteId, { allow_parent_check_inout: 0 });
    const pickupId = await linkedAccount("pickup", "toggle-off-pickup");
    seedSession(pickupId, "kid1329-toggle-off-pickup@example.test");

    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "in");
    const outcome = await failureDigest(() => checkInOutAction(fd));
    expect(outcome.kind).toBe("redirect");
    const rows = await queryAll("SELECT id FROM check_in WHERE child_id = ? AND type = 'in'", childId);
    expect(rows.length).toBe(1);
  });

  it("hides the parent check-in/out control when OFF and keeps attendance status visible", async () => {
    await updateInstitute(instituteId, { allow_parent_check_inout: 0 });
    const parentId = await linkedAccount("parent", "toggle-ui-parent");
    seedSession(parentId, "kid1329-toggle-ui-parent@example.test");

    const { default: ChildDetailPage } = await import("@/app/child/[id]/page");
    const markup = renderToStaticMarkup(
      await ChildDetailPage({ params: Promise.resolve({ id: childId }), searchParams: Promise.resolve({}) })
    );
    expect(markup).not.toContain(label("attendees.checkIn"));
    // Attendance status stays readable.
    expect(markup).toContain(label("attendees.notCheckedInYet"));

    // Control: ON keeps the control.
    await updateInstitute(instituteId, { allow_parent_check_inout: 1 });
    const onMarkup = renderToStaticMarkup(
      await ChildDetailPage({ params: Promise.resolve({ id: childId }), searchParams: Promise.resolve({}) })
    );
    expect(onMarkup).toContain(label("attendees.checkIn"));
  });

  it("mobile check-in: 403 with a clear error when OFF, 200 when ON", async () => {
    const { POST } = await import("@/app/api/mobile/children/[id]/check-in/route");
    await updateInstitute(instituteId, { allow_parent_check_inout: 0 });
    const parentId = await linkedAccount("parent", "toggle-mobile-parent");

    const token = createSessionToken({
      accountId: parentId,
      role: "parent",
      email: "kid1329-toggle-mobile-parent@example.test",
      emailConfirmed: true,
    } as never);
    const req = new NextRequest(`http://localhost/api/mobile/children/${childId}/check-in`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ type: "in" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: childId }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(String(body.error)).toContain("turned off parent check-in/out");
    expect(await queryAll("SELECT id FROM check_in WHERE child_id = ?", childId)).toEqual([]);

    // ON again: the same request succeeds.
    await updateInstitute(instituteId, { allow_parent_check_inout: 1 });
    const token2 = createSessionToken({
      accountId: parentId,
      role: "parent",
      email: "kid1329-toggle-mobile-parent@example.test",
      emailConfirmed: true,
    } as never);
    const req2 = new NextRequest(`http://localhost/api/mobile/children/${childId}/check-in`, {
      method: "POST",
      headers: { authorization: `Bearer ${token2}`, "content-type": "application/json" },
      body: JSON.stringify({ type: "in" }),
    });
    const res2 = await POST(req2, { params: Promise.resolve({ id: childId }) });
    expect(res2.status).toBe(200);
  });

  it("mobile child detail: a pickup link gets name/status only — no report, contacts, newsfeed, incidents", async () => {
    const { GET } = await import("@/app/api/mobile/children/[id]/route");
    const pickupId = await linkedAccount("pickup", "mobile-pickup-detail");
    const acc = await mustGet("SELECT email FROM account WHERE id = ?", pickupId);

    const token = createSessionToken({
      accountId: pickupId,
      role: "parent",
      email: String(acc.email),
      emailConfirmed: true,
    } as never);
    const req = new NextRequest(`http://localhost/api/mobile/children/${childId}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await GET(req, { params: Promise.resolve({ id: childId }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(String(json.child.id)).toBe(childId);
    expect(json.contacts === undefined && json.newsfeed === undefined && json.incidents === undefined).toBe(true);
    expect(json.todayReport).toBeUndefined();

    // Control: a parent link gets the full day view shape.
    const parentId = await linkedAccount("parent", "mobile-parent-detail");
    const parentAcc = await mustGet("SELECT email FROM account WHERE id = ?", parentId);
    const token2 = createSessionToken({
      accountId: parentId,
      role: "parent",
      email: String(parentAcc.email),
      emailConfirmed: true,
    } as never);
    const req2 = new NextRequest(`http://localhost/api/mobile/children/${childId}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token2}` },
    });
    const res2 = await GET(req2, { params: Promise.resolve({ id: childId }) });
    const json2 = await res2.json();
    expect(json2.todayReport).toBeDefined();
    expect(Array.isArray(json2.contacts)).toBe(true);
  });

  it("portal settings renders the toggle (checkbox), defaulting to checked", async () => {
    const { default: PortalSettingsPage } = await import("@/app/portal/settings/page");
    const admin = await mustGet("SELECT id, email FROM account WHERE role = 'owner'");
    sessionCookie.value = createSessionToken({
      accountId: String(admin.id),
      role: "owner",
      email: String(admin.email),
      emailConfirmed: true,
    } as never);

    let markup = renderToStaticMarkup(await PortalSettingsPage({ searchParams: Promise.resolve({}) } as never));
    expect(markup).toContain(label("settings.allowParentCheckInOut"));
    expect(markup).toContain('name="allowParentCheckInout"');
    expect(markup).toContain('value="1"');
    expect(markup).toContain("checked");

    // Toggle persisted OFF: the checkbox renders unchecked on the next visit.
    await updateInstitute(instituteId, { allow_parent_check_inout: 0 });
    markup = renderToStaticMarkup(await PortalSettingsPage({ searchParams: Promise.resolve({}) } as never));
    expect(markup).toContain('name="allowParentCheckInout"');
    expect(markup).not.toContain('type="checkbox" checked=""');
  });
});
