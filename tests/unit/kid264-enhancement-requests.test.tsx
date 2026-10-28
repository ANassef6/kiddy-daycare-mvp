// KID-258 A1 (KID-264): the owner-only "Enhancements requests" flow.
//
// Pinned here, mirroring the ticket:
//   1. The Tools tab rides the EXACT owner gate (same `role === "owner"`
//      block as Account billing — KID-246), NOT isAdminRole: a plain admin
//      sees the rest of Tools but never this tab; the tab label ships EN + AR.
//   2. /portal/enhancements re-checks the session: an owner renders the
//      submit form and the request list; admin / staff / carer / parent are
//      refused by redirect to /portal/dashboard — the tab and the URL stay
//      in sync.
//   3. The submit creates the record with status 'queued' and
//      customer_request = the daycare's NAME (e.g. "Sunshine Daycare"); the
//      form carries title + description ONLY (estimate/due date are set by
//      the team in Linear — locked answer on KID-258).
//   4. De-dup: an identical OPEN (non-terminal) title for the same daycare is
//      refused ('duplicate-open-title'); a synced request frees the title.
//   5. The sync write-back surface (lib/enhancements.applyLinearWriteBack +
//      POST /api/enhancements/write-back) is idempotent, tenant-scoped
//      (cross-daycare writes refused) and gated by the
//      KIDDY_ENHANCEMENTS_SYNC_TOKEN bearer (fail closed, timing-safe) —
//      never callable by the app's own Linear client, because there is none.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as store from "@/lib/store";
import { createDaycare, getInstitute } from "@/lib/store";
import {
  applyLinearWriteBack,
  createEnhancementRequest,
  getEnhancementRequest,
  listEnhancementRequests,
} from "@/lib/enhancements";
import { createSessionToken, createAccount, type Session } from "@/lib/auth";
import { dictionaries, keysOf } from "@/lib/i18n";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";
import { portalNav } from "@/components/PortalSidebar";
import * as writeBackRoute from "@/app/api/enhancements/write-back/route";

// The page + tenant resolver read the request head through next/headers; the
// suite injects the cookie per test instead of spinning a server (kid236
// harness, kid246 pattern).
const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    if (mockState.host) entries.host = mockState.host;
    return new Headers(entries);
  },
  cookies: () => ({ get: () => undefined, set: () => undefined }),
}));

function sessionCookieFor(accountId: string, role: string, email: string): string {
  const session: Session = { accountId, role, email, emailConfirmed: true };
  return `kiddy_sess=${createSessionToken(session)}`;
}

let sunshineIid: string;
let sunshineName: string;
let ownerId: string;
let ownerEmail: string;

beforeEach(async () => {
  await seedFixture();
  mockState.cookie = "";
  mockState.host = "";
  const inst = await queryGet("SELECT id, name FROM institute LIMIT 1");
  sunshineIid = String(inst!.id);
  sunshineName = String(inst!.name);
  const owner = await queryGet("SELECT id, email FROM account WHERE role = 'owner'");
  ownerId = String(owner!.id);
  ownerEmail = String(owner!.email);
});

// ---- 1. the Tools tab is owner-only (the EXACT owner gate) --------------------
describe("the Enhancements requests tab under Tools (owner-only)", () => {
  const toolsGroup = (dict: any, role?: string) =>
    portalNav(dict as never, role).find((g) => g.href === "/portal/report-center");

  it("the owner sees the tab; a plain admin and every other role do not", () => {
    for (const lang of ["en", "ar"] as const) {
      const dict = dictionaries[lang];
      const own = toolsGroup(dict, "owner")!.items.find((i) => i.href === "/portal/enhancements")!;
      expect(own).toBeDefined();
      expect(own.label).toBe(dict.nav.enhancements);

      // The plain admin keeps the Tools group but must NOT get this tab
      // (the exact `role === "owner"` gate, not isAdminRole).
      const adminHrefs = toolsGroup(dict, "admin")!.items.map((i) => i.href);
      expect(adminHrefs).not.toContain("/portal/enhancements");
      // Account billing rides the same gate; the two tabs stay siblings.
      expect(adminHrefs).not.toContain("/portal/account-billing");
      const ownerHrefs = toolsGroup(dict, "owner")!.items.map((i) => i.href);
      expect(ownerHrefs).toContain("/portal/account-billing");

      for (const role of ["staff", "carer", "parent"] as const) {
        expect(toolsGroup(dict, role)).toBeUndefined();
      }
    }
  });

  it("labels ship in EN and AR against lib/i18n", () => {
    expect(dictionaries.en.nav.enhancements).toBe("Enhancements requests");
    expect(dictionaries.ar.nav.enhancements).toBe("طلبات التحسينات");
  });
});

// ---- 2. i18n parity ----------------------------------------------------------
describe("the enhancements dictionary parity (EN + AR)", () => {
  it("every enhancements page key exists in both dictionaries", () => {
    const keys = (dict: Record<string, unknown>) =>
      keysOf(dict as never).filter((k) => k.startsWith("enhancements"));
    expect(keys(dictionaries.en).length).toBeGreaterThan(20);
    expect(keys(dictionaries.ar).sort()).toEqual(keys(dictionaries.en).sort());
  });
});

// ---- 3. the page gate: owner renders, every other role is refused ------------
describe("/portal/enhancements access", () => {
  async function renderPage(searchParams: Record<string, string> = {}): Promise<string> {
    const { default: Page } = await import("@/app/portal/enhancements/page");
    return renderToStaticMarkup(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (Page as any)({ searchParams })
    );
  }

  it("an owner session renders the submit form and the request list", async () => {
    await createEnhancementRequest({
      instituteId: sunshineIid,
      title: "Morning attendance export",
      description: "One click to export who is checked in.",
      requestedByAccountId: ownerId,
      customerRequest: sunshineName,
    });
    mockState.cookie = sessionCookieFor(ownerId, "owner", ownerEmail);
    const html = await renderPage();
    expect(html).toContain("Enhancements requests");
    expect(html).toContain("Morning attendance export");
    // Title + description ONLY: no priority/estimate/due-date inputs on the
    // form (locked answer KID-258).
    expect(html).not.toMatch(/name="estimate"/);
    expect(html).not.toMatch(/name="dueDate"/);
    expect(html).not.toMatch(/name="priority"/);
  });

  it("a non-owner session (admin / staff / parent) is refused at the URL", async () => {
    const admin = await createAccount({
      email: "plain-admin-enh@sunshinedaycare.test",
      password: "plain-admin-1",
      fullName: "Plain Admin",
      role: "admin",
    });
    const staff = await createAccount({
      email: "plain-staff-enh@sunshinedaycare.test",
      password: "plain-staff-1",
      fullName: "Plain Staff",
      role: "staff",
    });
    const parent = String(
      (await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id
    );
    for (const [accountId, role] of [
      [String(admin.id), "admin"],
      [String(staff.id), "staff"],
      [parent, "parent"],
    ] as Array<[string, string]>) {
      mockState.cookie = sessionCookieFor(accountId, role, "refused@sunshinedaycare.test");
      let digest = "";
      try {
        await renderPage();
      } catch (err) {
        digest = String((err as { digest?: unknown }).digest ?? "");
      }
      expect(digest).toContain("NEXT_REDIRECT");
      expect(digest).toContain("/portal/dashboard");
    }
  });
});

// ---- 4. the submit flow: queued + daycare name + de-dup ----------------------
describe("submitting an enhancement request", () => {
  it("creates a queued record with customer_request = the daycare name", async () => {
    const req = await createEnhancementRequest({
      instituteId: sunshineIid,
      title: "Weekly invoice summary email",
      description: "Send owners an email summary every Sunday.",
      requestedByAccountId: ownerId,
      customerRequest: sunshineName,
    });
    expect(req.status).toBe("queued");
    expect(req.customerRequest).toBe("Sunshine Daycare");
    expect(req.priority).toBe("");
    expect(req.estimate).toBeNull();
    expect(req.dueDate).toBe("");
    expect(req.expectedDelivery).toBe("");
    const stored = await getEnhancementRequest(req.id);
    expect(stored?.status).toBe("queued");
    expect(stored?.customerRequest).toBe(sunshineName);
    expect(stored?.instituteId).toBe(sunshineIid);
  });

  it("blocks an identical OPEN title for the same daycare, but not a synced one", async () => {
    const args = {
      instituteId: sunshineIid,
      title: "Duplicate title probe",
      description: "First body.",
      requestedByAccountId: ownerId,
      customerRequest: sunshineName,
    };
    const first = await createEnhancementRequest(args);
    await expect(
      createEnhancementRequest({ ...args, description: "Second body." })
    ).rejects.toThrow("duplicate-open-title");

    // A DIFFERENT daycare may hold the same open title (de-dup is per daycare).
    const other = await createDaycare({
      name: "Maple Tree Daycare",
      ownerEmail: "other-owner@test.example",
      ownerPassword: "other-owner-1",
      ownerFullName: "Other Owner",
    });
    await expect(
      createEnhancementRequest({ ...args, instituteId: other.instituteId })
    ).resolves.toBeTruthy();

    // Only 'synced' is terminal: once the first request is synced, the title
    // opens up again for a new round.
    await applyLinearWriteBack(first.id, sunshineIid, {
      kind: "linear_created",
      linearIssueId: "LIN-900",
      linearIssueUrl: "https://linear.app/kiddy/issue/LIN-900",
    });
    await expect(
      createEnhancementRequest(args)
    ).rejects.toThrow("duplicate-open-title"); // linear_created is still OPEN
    await applyLinearWriteBack(first.id, sunshineIid, {
      kind: "synced",
      priority: "medium",
      estimate: 2,
      dueDate: "2026-11-30",
      expectedDelivery: "2026-12-15",
    });
    await expect(createEnhancementRequest(args)).resolves.toBeTruthy();
  });
});

// ---- 5. the sync write-back: idempotent, scoped per daycare ------------------
describe("applyLinearWriteBack (the A2 sync contract)", () => {
  async function seedRequest(title: string, instituteId: string): Promise<string> {
    const req = await createEnhancementRequest({
      instituteId,
      title,
      description: "Sync probe.",
      requestedByAccountId: ownerId,
      customerRequest: sunshineName,
    });
    return req.id;
  }

  it("linear_created then synced, each step idempotent on exact replay", async () => {
    const id = await seedRequest("Idempotency probe", sunshineIid);

    const step1 = await applyLinearWriteBack(id, sunshineIid, {
      kind: "linear_created",
      linearIssueId: "LIN-77",
      linearIssueUrl: "https://linear.app/kiddy/issue/LIN-77",
    });
    expect(step1.status).toBe("linear_created");
    expect(step1.linearIssueId).toBe("LIN-77");

    // Exact replay: same packet, same values, no change (200-equivalent).
    const replay1 = await applyLinearWriteBack(id, sunshineIid, {
      kind: "linear_created",
      linearIssueId: "LIN-77",
      linearIssueUrl: "https://linear.app/kiddy/issue/LIN-77",
    });
    expect(replay1.status).toBe("linear_created");
    expect(replay1.linearIssueId).toBe("LIN-77");

    const row = await getEnhancementRequest(id);
    expect(row?.status).toBe("linear_created");

    const step2 = await applyLinearWriteBack(id, sunshineIid, {
      kind: "synced",
      priority: "high",
      estimate: 5,
      dueDate: "2026-11-01",
      expectedDelivery: "2026-11-20",
    });
    expect(step2.status).toBe("synced");
    expect(step2.priority).toBe("high");
    expect(step2.estimate).toBe(5);
    expect(step2.dueDate).toBe("2026-11-01");
    expect(step2.expectedDelivery).toBe("2026-11-20");
    expect(step2.lastSyncedAt).toBeTruthy();

    const replay2 = await applyLinearWriteBack(id, sunshineIid, {
      kind: "synced",
      priority: "high",
      estimate: 5,
      dueDate: "2026-11-01",
      expectedDelivery: "2026-11-20",
    });
    expect(replay2.status).toBe("synced");
    const after = await getEnhancementRequest(id);
    expect(after?.status).toBe("synced");
    expect(after?.estimate).toBe(5);
  });

  it("never allows cross-daycare writes (tenant mismatch refused)", async () => {
    const id = await seedRequest("Cross-tenant probe", sunshineIid);
    const other = await createDaycare({
      name: "Cross Tenant Daycare",
      ownerEmail: "cross-owner@test.example",
      ownerPassword: "cross-owner-1",
      ownerFullName: "Cross Owner",
    });
    const otherIid = other.instituteId;
    await expect(
      applyLinearWriteBack(id, otherIid, {
        kind: "linear_created",
        linearIssueId: "LIN-1000",
        linearIssueUrl: "https://linear.app/kiddy/issue/LIN-1000",
      })
    ).rejects.toThrow("enhancement-tenant-mismatch");
    expect((await getEnhancementRequest(id))?.status).toBe("queued");
    // The wrong tenant never gained the issue id either.
    expect((await getEnhancementRequest(id))?.linearIssueId).toBe("");
  });

  it("refuses regressions: no re-open of a synced request", async () => {
    const id = await seedRequest("Terminal probe", sunshineIid);
    await applyLinearWriteBack(id, sunshineIid, {
      kind: "linear_created",
      linearIssueId: "LIN-71",
      linearIssueUrl: "https://linear.app/kiddy/issue/LIN-71",
    });
    await applyLinearWriteBack(id, sunshineIid, { kind: "synced", estimate: 1 });
    await expect(
      applyLinearWriteBack(id, sunshineIid, {
        kind: "linear_created",
        linearIssueId: "LIN-99",
        linearIssueUrl: "https://linear.app/kiddy/issue/LIN-99",
      })
    ).rejects.toThrow("enhancement-already-synced");
    expect((await getEnhancementRequest(id))?.linearIssueId).toBe("LIN-71");

    // synced *exiting* linear_created without the intermediate step is also
    // refused — the queue keeps its ordered lifecycle.
    const id2 = await seedRequest("Order probe", sunshineIid as string);
    await expect(
      applyLinearWriteBack(id2, sunshineIid, { kind: "synced", estimate: 1 })
    ).rejects.toThrow("enhancement-not-linear-created");
  });

  it("sync_error keeps the record open + retryable, and a later success fixes it", async () => {
    const id = await seedRequest("Retry probe", sunshineIid);
    const err = await applyLinearWriteBack(id, sunshineIid, {
      kind: "sync_error",
      syncErrorDetail: "Linear 502 while creating issue",
    });
    expect(err.status).toBe("sync_error");
    expect(err.syncErrorDetail).toBe("Linear 502 while creating issue");
    // Still OPEN for the de-dup: a same-title double submit stays blocked
    // while the retry loop owns it.
    await expect(
      createEnhancementRequest({
        instituteId: sunshineIid,
        title: "Retry probe",
        description: "again",
        requestedByAccountId: ownerId,
        customerRequest: sunshineName,
      })
    ).rejects.toThrow("duplicate-open-title");

    const fixed = await applyLinearWriteBack(id, sunshineIid, {
      kind: "linear_created",
      linearIssueId: "LIN-55",
      linearIssueUrl: "https://linear.app/kiddy/issue/LIN-55",
    });
    expect(fixed.status).toBe("linear_created");
    expect(fixed.syncErrorDetail).toBe("");
  });
});

// ---- 6. the write-back ROUTE: token auth + status codes ----------------------
describe("POST /api/enhancements/write-back (the A2 route)", () => {
  function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const { POST } = writeBackRoute as unknown as {
      POST: (req: Request) => Promise<Response>;
    };
    return POST(
      new Request("http://localhost/api/enhancements/write-back", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      })
    );
  }

  it("is fail closed without the env token, and refuses wrong tokens", async () => {
    delete process.env.KIDDY_ENHANCEMENTS_SYNC_TOKEN;
    const disabled = await post({ requestId: "x", instituteId: sunshineIid, kind: "synced" });
    expect(disabled.status).toBe(503);

    process.env.KIDDY_ENHANCEMENTS_SYNC_TOKEN = "probe-secret-token";
    const bad = await post(
      { requestId: "x", instituteId: sunshineIid, kind: "synced" },
      { authorization: "Bearer wrong-token" }
    );
    expect(bad.status).toBe(401);
    const none = await post({ requestId: "x", instituteId: sunshineIid, kind: "synced" });
    expect(none.status).toBe(401);
    delete process.env.KIDDY_ENHANCEMENTS_SYNC_TOKEN;
  });

  it("accepted token: idempotent write-back over the full route", async () => {
    const req = await createEnhancementRequest({
      instituteId: sunshineIid,
      title: "Route probe",
      description: "routed write-back",
      requestedByAccountId: ownerId,
      customerRequest: sunshineName,
    });
    const token = "probe-route-token";
    process.env.KIDDY_ENHANCEMENTS_SYNC_TOKEN = token;
    const auth = { authorization: `Bearer ${token}` };

    const missing = await post({ requestId: req.id }, auth);
    expect(missing.status).toBe(400);

    const created = await post(
      {
        requestId: req.id,
        instituteId: sunshineIid,
        kind: "linear_created",
        linearIssueId: "LIN-42",
        linearIssueUrl: "https://linear.app/kiddy/issue/LIN-42",
      },
      auth
    );
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { request: { status: string } };
    expect(createdBody.request.status).toBe("linear_created");

    const replay = await post(
      {
        requestId: req.id,
        instituteId: sunshineIid,
        kind: "linear_created",
        linearIssueId: "LIN-42",
        linearIssueUrl: "https://linear.app/kiddy/issue/LIN-42",
      },
      auth
    );
    expect(replay.status).toBe(200);

    const wrongTenant = await post(
      {
        requestId: req.id,
        instituteId: "other-institute",
        kind: "synced",
        estimate: 1,
      },
      auth
    );
    expect(wrongTenant.status).toBe(403);

    const synced = await post(
      {
        requestId: req.id,
        instituteId: sunshineIid,
        kind: "synced",
        priority: "low",
        estimate: 3,
        dueDate: "2026-12-01",
        expectedDelivery: "2026-12-10",
      },
      auth
    );
    expect(synced.status).toBe(200);

    const latest = await getEnhancementRequest(req.id);
    expect(latest?.status).toBe("synced");
    expect(latest?.priority).toBe("low");
    expect(latest?.estimate).toBe(3);
    expect(latest?.dueDate).toBe("2026-12-01");
    expect(latest?.expectedDelivery).toBe("2026-12-10");

    const regression = await post(
      {
        requestId: req.id,
        instituteId: sunshineIid,
        kind: "linear_created",
        linearIssueId: "LIN-43",
        linearIssueUrl: "https://linear.app/kiddy/issue/LIN-43",
      },
      auth
    );
    expect(regression.status).toBe(409);

    const unknown = await post(
      { requestId: "no-such-request", instituteId: sunshineIid, kind: "synced" },
      auth
    );
    expect(unknown.status).toBe(404);

    delete process.env.KIDDY_ENHANCEMENTS_SYNC_TOKEN;
  });
});
