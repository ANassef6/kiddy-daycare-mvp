// KID-372: cross-tenant authorize-by-id gaps — shared-resource actions and
// parent pages used to authorize by a RAW resource id alone (single-centre
// pin thinking). With more than one daycare in the table that let anyone —
// including anonymous POSTS riding the legacy first-institute fallback —
// read/write across centres:
//
//   1. setTicketStatusAction had NO session guard at all;
//   2. getRoom/updateRoom + the /portal/rooms/[id] page accepted any id;
//   3. the parent /child/[id] page rendered another centre's child data;
//   4. setFormResponseStatusAction / generateFormShareLinkAction /
//      updateSupplyStatusAction were authed but never verified the id
//      against the session's institute;
//   5. createTagAction / createSmartListAction had no authAccount() guard —
//      an anonymous POST wrote into the first-created daycare.
//
// Every refusal below follows the kid152/kid212 fail-closed patterns: the
// cross-tenant id never reaches a write or a render, anonymous gets /login,
// and a foreign-centre id gets /login?error=wrong-tenant (the wording is
// rendered on /login in BOTH dictionaries). Every refusal is asserted as
// absence of data, not just a redirect (the repo's leak history: KID-152,
// KID-207).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- request-scope mock: actions read cookies(), pages and the tenant
// resolver read headers; tests inject both per test instead of spinning a
// server. redirect()/notFound() throw the same sentinels Next uses, so a
// refusal FAILS the test loudly instead of rendering. -----------------------
const sessionCookie = { value: "" };
let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined) }),
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
}));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    redirect: (url: string) => {
      const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
      err.digest = `NEXT_REDIRECT;replace;${url};`;
      throw err;
    },
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
});

import * as store from "@/lib/store";
import { createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { isChildVisibleToAccount } from "@/lib/store";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";
const SUNSHINE_HOST = `sunshine-daycare.${APEX}`;
const TENANT_REFUSAL = "/login?error=wrong-tenant";

let sunshineIid: string;
let mapleIid: string;
let mapleOwnerAccountId: string;
let sunshineAdminId: string;
let sunshineParentId: string;
let sunshineTicketId: string;
let sunshineRoomId: string;

/** Runs a server action and returns the redirect target its refusal/success
 *  produced (the kid236 harness — "" when the action returned normally). */
async function redirectTargetFor(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    if (String((err as Error)?.message ?? "") === "NEXT_NOT_FOUND") return "NEXT_NOT_FOUND";
    throw err;
  }
}

function formData(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

function sessionFor(accountId: string, email: string, role: string): void {
  sessionCookie.value = createSessionToken({ accountId, email, role, emailConfirmed: true });
}

beforeEach(async () => {
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  sessionCookie.value = "";
  mockHeaders = {};
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute WHERE name = 'Sunshine Daycare'"))!.id);
  sunshineRoomId = String((await queryGet("SELECT id FROM room WHERE institute_id = ? ORDER BY created_at", sunshineIid))!.id);
  sunshineTicketId = String(
    (await queryGet("SELECT id FROM support_ticket WHERE institute_id = ?", sunshineIid))!.id
  );
  sunshineAdminId = String((await queryGet("SELECT id FROM account WHERE email = 'trois4ever+admin@gmail.com'"))!.id);
  sunshineParentId = String((await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id);
  // The second tenant, through the real platform path, so its owner and
  // records match production shapes.
  const maple = await store.createDaycare({
    name: "Maple Tree Daycare",
    subdomain: "mapletree",
    ownerEmail: "owner@mapletree.test",
    ownerPassword: "maple-owner-1",
    ownerFullName: "Maple Owner",
  });
  mapleIid = maple.instituteId;
  mapleOwnerAccountId = maple.ownerAccountId;
});

afterEach(() => {
  delete process.env.PUBLIC_APEX_DOMAIN;
});

// ---------------------------------------------------------------------------
// 1. setTicketStatusAction
// ---------------------------------------------------------------------------
describe("KID-372: setTicketStatusAction — session + institute ownership", () => {
  it("an anonymous POST is refused with /login and the ticket stays untouched", async () => {
    sessionCookie.value = "";
    const { setTicketStatusAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      setTicketStatusAction(formData({ ticketId: sunshineTicketId, status: "closed" }))
    );
    expect(target).toBe("/login");
    expect(
      String((await queryGet("SELECT status FROM support_ticket WHERE id = ?", sunshineTicketId))!.status)
    ).toBe("open");
  });

  it("a staff session of the ticket's own centre can flip it (positive path)", async () => {
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { setTicketStatusAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      setTicketStatusAction(formData({ ticketId: sunshineTicketId, status: "answered" }))
    );
    expect(target).toBe("/portal/support-inbox");
    expect(
      String((await queryGet("SELECT status FROM support_ticket WHERE id = ?", sunshineTicketId))!.status)
    ).toBe("answered");
  });

  it("a FOREIGN centre's ticket id is refused fail closed (no write, no render)", async () => {
    // The Sunshine admin POSTing Maple's ticket id: the raw id used to win.
    const mapleTicket = await store.createSupportTicket({
      instituteId: mapleIid,
      accountId: mapleOwnerAccountId,
      subject: "Maple pickup change",
      body: "Cross-centre probe.",
    });
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { setTicketStatusAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      setTicketStatusAction(
        formData({ ticketId: String(mapleTicket.id), status: "closed" }),
      )
    );
    expect(target).toBe(TENANT_REFUSAL);
    expect(
      String((await queryGet("SELECT status FROM support_ticket WHERE id = ?", String(mapleTicket.id)))!.status)
    ).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// 2. getRoom (/portal/rooms/[id]) + updateRoomAction
// ---------------------------------------------------------------------------
describe("KID-372: room detail page + updateRoomAction — institute ownership", () => {
  it("the page renders the centre's own room for its admin (positive path)", async () => {
    mockHeaders = {
      host: SUNSHINE_HOST,
      cookie: `kiddy_sess=${encodeURIComponent(
        createSessionToken({ accountId: sunshineAdminId, email: "trois4ever+admin@gmail.com", role: "owner", emailConfirmed: true })
      )}`,
    };
    const { default: RoomPage } = await import("@/app/portal/rooms/[id]/page");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(await RoomPage({ params: Promise.resolve({ id: sunshineRoomId }) }));
    expect(html).toContain("Toddlers");
  });

  it("the page 404s another centre's room by URL id (fail closed)", async () => {
    const mapleRoom = await store.createRoom(mapleIid, "Maple Room", 5);
    mockHeaders = {
      host: SUNSHINE_HOST,
      cookie: `kiddy_sess=${encodeURIComponent(
        createSessionToken({ accountId: sunshineAdminId, email: "trois4ever+admin@gmail.com", role: "owner", emailConfirmed: true })
      )}`,
    };
    const { default: RoomPage } = await import("@/app/portal/rooms/[id]/page");
    await expect(RoomPage({ params: Promise.resolve({ id: String(mapleRoom.id) }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("updateRoomAction refuses another centre's room by raw id (no write)", async () => {
    const mapleRoom = await store.createRoom(mapleIid, "Maple Room", 5);
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { updateRoomAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      updateRoomAction(
        formData({ roomId: String(mapleRoom.id), name: "Hijacked", capacity: "1", colour: "#FF0000" })
      )
    );
    expect(target).toBe(TENANT_REFUSAL);
    const row = await queryGet("SELECT name, institute_id FROM room WHERE id = ?", String(mapleRoom.id));
    expect(String(row!.name)).toBe("Maple Room");
  });

  it("updateRoomAction still edits the centre's own room (positive path)", async () => {
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { updateRoomAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      updateRoomAction(formData({ roomId: sunshineRoomId, name: "Toddlers II", capacity: "14", colour: "#00FF00" }))
    );
    expect(target).toBe(`/portal/rooms/${sunshineRoomId}`);
    expect(String((await queryGet("SELECT name FROM room WHERE id = ?", sunshineRoomId))!.name)).toBe("Toddlers II");
  });
});

// ---------------------------------------------------------------------------
// 3. parent /child/[id] + isChildVisibleToAccount
// ---------------------------------------------------------------------------
describe("KID-372: parent /child/[id] — family-scoped child visibility", () => {
  function childIds(): Promise<{ ella: string; maple: string }> {
    return (async () => {
      const mapleRoom = await store.createRoom(mapleIid, "Maple Room", 5);
      const mapleChild = await store.createChild({
        instituteId: mapleIid,
        firstName: "Maple",
        lastName: "Kid",
        roomId: String(mapleRoom.id),
      });
      const ella = String((await queryGet("SELECT id FROM child WHERE first_name = 'Ella'"))!.id);
      return { ella, maple: String(mapleChild.id) };
    })();
  }

  it("isChildVisibleToAccount: the parent passes on their OWN institute child only", async () => {
    const { ella, maple } = await childIds();
    // Own child, own tenancy.
    expect(await isChildVisibleToAccount(sunshineIid, sunshineParentId, ella)).toBe(true);
    // A foreign centre's child id is never visible to this parent — the
    // isChildInScope admin rule (roomIds null → pass) must not leak here.
    expect(await isChildVisibleToAccount(sunshineIid, sunshineParentId, maple)).toBe(false);
    expect(await isChildVisibleToAccount(mapleIid, sunshineParentId, ella)).toBe(false);
    // The empty request tenant (cross-tenant session / unknown host) has no
    // fallback authorization either.
    expect(await isChildVisibleToAccount("", sunshineParentId, ella)).toBe(false);
  });

  it("isChildVisibleToAccount: a same-centre parent with NO family link is refused", async () => {
    const { createAccount } = await import("@/lib/auth");
    const stranger = await createAccount({
      email: "stranger-parent@example.test",
      password: "kiddy-parent",
      fullName: "Stranger Parent",
      role: "parent",
    });
    const { ella } = await childIds();
    // The old rule (child exists AND parent role) would have passed here.
    expect(await isChildVisibleToAccount(sunshineIid, String(stranger.id), ella)).toBe(false);
  });

  it("isChildVisibleToAccount: staff without classroom records in scope get nothing", async () => {
    // A fresh unassigned Sunshine staff account has no classroom records to
    // authorize with — and no family link — so nothing is visible (the
    // KID-103 rule fail closed). On master before the guard the ownership
    // query alone (child exists) was all a session needed.
    const { createAccount } = await import("@/lib/auth");
    const staffAccount = await createAccount({
      email: "unassigned-staff@sunshinedaycare.test",
      password: "kiddy-staff",
      fullName: "Unassigned Staff",
      role: "staff",
    });
    const { ella, maple } = await childIds();
    expect(await isChildVisibleToAccount(sunshineIid, String(staffAccount.id), ella)).toBe(false);
    expect(await isChildVisibleToAccount(sunshineIid, String(staffAccount.id), maple)).toBe(false);
  });

  it("the page renders the parent's own child on the tenant host (kid254 stays green)", async () => {
    const { ella } = await childIds();
    mockHeaders = {
      host: SUNSHINE_HOST,
      cookie: `kiddy_sess=${encodeURIComponent(
        createSessionToken({ accountId: sunshineParentId, email: "parent@example.test", role: "parent", emailConfirmed: true })
      )}`,
    };
    const { default: ChildPage } = await import("@/app/child/[id]/page");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(await ChildPage({ params: Promise.resolve({ id: ella }) }));
    expect(html).toContain("Ella");
  });

  it("the page 404s a foreign centre's child id instead of rendering its data", async () => {
    const { maple } = await childIds();
    mockHeaders = {
      host: SUNSHINE_HOST,
      cookie: `kiddy_sess=${encodeURIComponent(
        createSessionToken({ accountId: sunshineParentId, email: "parent@example.test", role: "parent", emailConfirmed: true })
      )}`,
    };
    const { default: ChildPage } = await import("@/app/child/[id]/page");
    await expect(ChildPage({ params: Promise.resolve({ id: maple }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the page 404s a foreign-centre child id on the apex host too (no fallback)", async () => {
    const { maple } = await childIds();
    mockHeaders = {
      host: `www.${APEX}`,
      cookie: `kiddy_sess=${encodeURIComponent(
        createSessionToken({ accountId: sunshineParentId, email: "parent@example.test", role: "parent", emailConfirmed: true })
      )}`,
    };
    const { default: ChildPage } = await import("@/app/child/[id]/page");
    await expect(ChildPage({ params: Promise.resolve({ id: maple }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// 4. setFormResponseStatusAction
// ---------------------------------------------------------------------------
describe("KID-372: setFormResponseStatusAction — response verified against the session's institute", () => {
  async function insertResponse(formId: string): Promise<string> {
    const id = `resp-${formId}`;
    await queryRun("INSERT INTO form_response (id, form_id, answers_json, status) VALUES (?, ?, '{}', 'new')", id, formId);
    return id;
  }

  it("flips a response of the centre's own form (positive path)", async () => {
    const form = await store.createForm({ instituteId: sunshineIid, kind: "form", title: "S form" });
    const responseId = await insertResponse(String(form.id));
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { setFormResponseStatusAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      setFormResponseStatusAction(formData({ responseId, status: "contacted" }))
    );
    expect(target).toBe("/portal/forms");
    expect(String((await queryGet("SELECT status FROM form_response WHERE id = ?", responseId))!.status)).toBe("contacted");
  });

  it("refuses a response whose form belongs to another centre (no flip)", async () => {
    const mapleForm = await store.createForm({ instituteId: mapleIid, kind: "form", title: "M form" });
    const responseId = await insertResponse(String(mapleForm.id));
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { setFormResponseStatusAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      setFormResponseStatusAction(formData({ responseId, status: "archived", formId: String(mapleForm.id) }))
    );
    expect(target).toBe(TENANT_REFUSAL);
    expect(String((await queryGet("SELECT status FROM form_response WHERE id = ?", responseId))!.status)).toBe("new");
  });
});

// ---------------------------------------------------------------------------
// 5. generateFormShareLinkAction
// ---------------------------------------------------------------------------
describe("KID-372: generateFormShareLinkAction — share tokens only for own forms", () => {
  it("mints a share token for the centre's own form (positive path)", async () => {
    const form = await store.createForm({ instituteId: sunshineIid, kind: "list", title: "Own list" });
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { generateFormShareLinkAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      generateFormShareLinkAction(formData({ formId: String(form.id) }))
    );
    expect(target).toBe("/portal/forms");
    expect(String((await queryGet("SELECT share_token FROM form_template WHERE id = ?", String(form.id)))!.share_token)).not.toBe("");
  });

  it("refuses to mint a share link for another centre's form by raw id", async () => {
    const mapleForm = await store.createForm({ instituteId: mapleIid, kind: "list", title: "Maple list" });
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { generateFormShareLinkAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      generateFormShareLinkAction(formData({ formId: String(mapleForm.id) }))
    );
    expect(target).toBe(TENANT_REFUSAL);
    expect((await queryGet("SELECT share_token FROM form_template WHERE id = ?", String(mapleForm.id)))!.share_token ?? "").toBe("");
  });
});

// ---------------------------------------------------------------------------
// 6. updateSupplyStatusAction
// ---------------------------------------------------------------------------
describe("KID-372: updateSupplyStatusAction — institute-owned supplies", () => {
  it("updates the centre's own supply (positive path)", async () => {
    const supply = await store.createSupply({
      instituteId: sunshineIid,
      title: "Crayons",
      quantity: 10,
      unit: "boxes",
    });
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { updateSupplyStatusAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      updateSupplyStatusAction(formData({ id: String(supply.id), status: "donated" }))
    );
    expect(target).toBe("/portal/supplies");
    expect(String((await queryGet("SELECT status FROM supply_request WHERE id = ?", String(supply.id)))!.status)).toBe("donated");
  });

  it("refuses another centre's supply id (no flip, no newsfeed side effect)", async () => {
    const mapleSupply = await store.createSupply({
      instituteId: mapleIid,
      title: "Maple wipes",
      quantity: 2,
      unit: "packs",
    });
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { updateSupplyStatusAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      updateSupplyStatusAction(formData({ id: String(mapleSupply.id), status: "donated" }))
    );
    expect(target).toBe(TENANT_REFUSAL);
    expect(String((await queryGet("SELECT status FROM supply_request WHERE id = ?", String(mapleSupply.id)))!.status)).toBe("needed");
    expect(
      (await queryGet("SELECT COUNT(*) AS c FROM newsfeed_post WHERE body LIKE 'Supplies update:%'"))!.c
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. createTagAction / createSmartListAction — no anonymous first-institute write
// ---------------------------------------------------------------------------
describe("KID-372: createTagAction / createSmartListAction — authAccount() first", () => {
  async function tagCounts(): Promise<{ sunshine: number; maple: number }> {
    return {
      sunshine: Number((await queryGet("SELECT COUNT(*) AS c FROM tag WHERE institute_id = ?", sunshineIid))!.c),
      maple: Number((await queryGet("SELECT COUNT(*) AS c FROM tag WHERE institute_id = ?", mapleIid))!.c),
    };
  }

  it("an anonymous POST cannot write a tag into ANY daycare (no first-institute ride)", async () => {
    sessionCookie.value = "";
    const { createTagAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => createTagAction(formData({ name: "Ghost", color: "#111111" })));
    expect(target).toBe("/login");
    const before = await tagCounts();
    expect(before.maple).toBe(0);
    expect(before.sunshine).toBe(3); // the seeded demo tags only
  });

  it("an anonymous POST cannot write a smart list either", async () => {
    sessionCookie.value = "";
    const { createSmartListAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => createSmartListAction(formData({ name: "Ghost list" })));
    expect(target).toBe("/login");
    const counts = await tagCounts();
    expect(counts.maple).toBe(0);
    expect(counts.sunshine).toBe(3);
  });

  it("a signed-in session writes tags into its OWN request tenant only (positive path)", async () => {
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { createTagAction, createSmartListAction } = await import("@/lib/actions");
    expect(
      await redirectTargetFor(() => createTagAction(formData({ name: "Sunshine Tag", color: "#222222" })))
    ).toBe("/portal/tags");
    expect(
      await redirectTargetFor(() => createSmartListAction(formData({ name: "Sunshine List" })))
    ).toBe("/portal/tags");
    const counts = await tagCounts();
    expect(counts.maple).toBe(0);
    expect(counts.sunshine).toBe(5);
  });

  it("a cross-tenant session cannot borrow another host's tenant", async () => {
    // Maple owner POSTing a tag against Sunshine's host: the request tenant
    // (lib/tenant.ts cross-tenant rule) resolves EMPTY — fail closed. The
    // mocked request scope carries BOTH surfaces actions read: the session
    // cookie and the raw Cookie header the tenant resolver parses.
    const mapleToken = createSessionToken({ accountId: mapleOwnerAccountId, email: "owner@mapletree.test", role: "owner", emailConfirmed: true });
    mockHeaders = { host: SUNSHINE_HOST, cookie: `kiddy_sess=${encodeURIComponent(mapleToken)}` };
    sessionCookie.value = mapleToken;
    const { createTagAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => createTagAction(formData({ name: "Cross", color: "#333333" })));
    expect(target).toBe(TENANT_REFUSAL);
    const counts = await tagCounts();
    expect(counts.maple).toBe(0);
    expect(counts.sunshine).toBe(3);
  });
});
