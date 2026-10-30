// KID-246: Finance/3 — the owner-only "Account billing" tab under Tools and
// the daycare invoice notifications.
//
// Pinned here, mirroring the ticket:
//   1. The sidebar tab exists ONLY for the exact owner role (not admin,
//      staff, carer, parent) and carries EN + AR labels from lib/i18n.ts —
//      the portal-nav test pattern (a pure function over the dictionary).
//   2. Every page-level key ships in BOTH dictionaries (the kid245 parity
//      pattern), so the page cannot silently render English for AR accounts.
//   3. /portal/account-billing is reachable ONLY with an owner session; any
//      other role is refused by redirect — the same mocked-headers harness
//      kid236 documents (no server spun up in the suite).
//   4. Creating an invoice notifies the daycare's owner: a NEW invoice
//      surfaces in the in-app recentActivityFeed slice (derived from the
//      ledger, honoring the "billing"/inapp notification preference), and a
//      best-effort owner email goes through the existing Supabase GoTrue
//      path with no new mail dependency (the kid238 provider-mock pattern).
//   5. The pre-disable warnings show up in the feed while the owner can
//      still act: a pending invoice due within 3 days, and every open
//      overdue invoice regardless of when it was created.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as store from "@/lib/store";
import { createDaycare, setNotificationPref, recentActivityFeed } from "@/lib/store";
import { generateDueInvoices, getDaycareBilling, listInvoices, updateDaycareBilling } from "@/lib/billing";
import { createSessionToken, createAccount, type Session } from "@/lib/auth";
import { dictionaries, keysOf } from "@/lib/i18n";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";
import { portalNav } from "@/components/PortalSidebar";

// The page + tenant resolver read the request head through next/headers; the
// suite injects the cookie per test instead of spinning a server (kid236
// harness). requireSession reads headers(), the tenant resolver too.
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

const utcDate = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));
const daysAgoIso = (days: number): string =>
  new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
const daysAheadIsoDate = (days: number): string =>
  new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

// Seeds one explicit daycare_invoice row (the raw pattern kid245's gate tests use).
async function seedInvoice(args: {
  id: string;
  cycleMonth: string;
  dueDate: string;
  status: "pending" | "paid" | "overdue";
  createdAt: string;
  totalAmount?: number;
  paidAt?: string;
}): Promise<void> {
  await queryRun(
    `INSERT INTO daycare_invoice
       (id, institute_id, cycle_month, plan, max_active_children, billable_children,
        flat_rate_amount, incremental_rate, incremental_amount, total_amount, currency,
        due_date, status, created_at, paid_at)
     VALUES (?, ?, ?, 'monthly', 12, 2, 500, 50, 100, ?, 'EGP', ?, ?, ?, ?)`,
    args.id,
    sunshineIid,
    args.cycleMonth,
    args.totalAmount ?? 600,
    args.dueDate,
    args.status,
    args.createdAt,
    args.paidAt ?? null
  );
}

let sunshineIid: string;
let ownerId: string;
let ownerEmail: string;

beforeEach(async () => {
  await seedFixture();
  mockState.cookie = "";
  mockState.host = "";
  const owner = await queryGet("SELECT id, email FROM account WHERE role = 'owner'");
  ownerId = String(owner!.id);
  ownerEmail = String(owner!.email);
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
});

// ---- 1. the Tools tab is owner-only ------------------------------------------
describe("the Account billing tab under Tools (owner-only)", () => {
  const toolsGroup = (dict: any, role?: string) =>
    portalNav(dict as never, role).find((g) => g.href === "/portal/report-center");

  it("the owner sees the tab; every other role does not", () => {
    for (const lang of ["en", "ar"] as const) {
      const dict = dictionaries[lang];
      const ownerGroup = toolsGroup(dict, "owner")!;
      const own = ownerGroup.items.find((i) => i.href === "/portal/account-billing")!;
      expect(own).toBeDefined();
      expect(own.label).toBe(dict.nav.accountBilling);

      for (const role of ["admin", "staff", "carer", "parent"] as const) {
        const group = toolsGroup(dict, role);
        if (role !== "admin") {
          // No Tools group at all — the isAdminRole gate is unchanged.
          expect(group).toBeUndefined();
          continue;
        }
        expect(group).toBeDefined();
        expect(group!.items.map((i) => i.href)).not.toContain("/portal/account-billing");
      }
      // The admin keeps every other Tools surface byte-for-byte; the owner
      // tabs are purely additive. KID-258 A1 (KID-264): "Enhancements
      // requests" rides the SAME exact-owner gate as Account billing, so the
      // additive diff now excludes both owner-only tabs.
      expect(toolsGroup(dict, "admin")!.items.map((i) => i.href)).toEqual(
        ownerGroup.items.map((i) => i.href).filter(
          (h) => h !== "/portal/account-billing" && h !== "/portal/enhancements"
        )
      );
    }
  });

  it("labels ship in EN and AR against lib/i18n", () => {
    expect(dictionaries.en.nav.accountBilling).toBe("Account billing");
    expect(dictionaries.ar.nav.accountBilling).toBe("فواتير الحساب");
  });
});

// ---- 2. i18n parity ----------------------------------------------------------
describe("the accountBilling dictionary parity (EN + AR)", () => {
  it("every accountBilling page key exists in both dictionaries", () => {
    const keys = (dict: Record<string, unknown>) =>
      keysOf(dict as never).filter((k) => k.startsWith("accountBilling"));
    expect(keys(dictionaries.en).length).toBeGreaterThan(30);
    expect(keys(dictionaries.ar).sort()).toEqual(keys(dictionaries.en).sort());
  });
});

// ---- 3. the page gate: owner renders, every other role is refused ------------
describe("/portal/account-billing access", () => {
  function sessionCookieFor(accountId: string, role: string, email: string): string {
    const session: Session = { accountId, role, email, emailConfirmed: true };
    return `kiddy_sess=${createSessionToken(session)}`;
  }

  async function renderPage(): Promise<string> {
    const { default: Page } = await import("@/app/portal/account-billing/page");
    return renderToStaticMarkup(await Page());
  }

  it("an owner session renders the plan card, rates and the invoice ledger", async () => {
    mockState.cookie = sessionCookieFor(ownerId, "owner", ownerEmail);
    await seedInvoice({
      id: "inv-246-a",
      cycleMonth: "2026-02",
      dueDate: "2026-04-05",
      status: "paid",
      createdAt: daysAgoIso(20),
      totalAmount: 600,
      paidAt: "2026-04-02 10:00:00",
    });
    await seedInvoice({
      id: "inv-246-b",
      cycleMonth: "2026-03",
      dueDate: daysAheadIsoDate(2),
      status: "pending",
      createdAt: daysAgoIso(20),
      totalAmount: 550,
    });
    const html = await renderPage();
    expect(html).toContain("Account billing");
    // The read-only rates (the platform defaults Sunshine renders).
    const billing = await getDaycareBilling(sunshineIid);
    expect(html).toContain(billing.monthlyRateEgp.toString());
    expect(html).toContain(billing.perChildRateEgp.toString());
    // The ledger: cycle, amount, due date, status, paid date.
    expect(html).toContain("2026-02");
    expect(html).toContain("600");
    expect(html).toContain("2026-04-05");
    // The upcoming/overdue state — the 2-days-out invoice warns inside the
    // 3-day window (pre-disable), and the paid invoice shows its paid date.
    expect(html).toContain("due on");
    expect(html).toContain("2026-04-02");
  });

  it("a non-owner session (admin / parent) is refused at the URL", async () => {
    const admin = await createAccount({
      email: "plain-admin-246@sunshinedaycare.test",
      password: "plain-admin-1",
      fullName: "Plain Admin",
      role: "admin",
    });
    const parent = String(
      (await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id
    );
    for (const [accountId, role] of [
      [String(admin.id), "admin"],
      [parent, "parent"],
    ] as Array<[string, string]>) {
      mockState.cookie = sessionCookieFor(accountId, role, "refused@sunshinedaycare.test");
      let digest = "";
      try {
        await renderPage();
      } catch (err) {
        digest = String((err as { digest?: unknown }).digest ?? "");
      }
      // Exactly the finance/3 refusal: no owner content anywhere in the
      // error, and the bounce goes to the owner's-own redirect target.
      expect(digest).toContain("NEXT_REDIRECT");
      expect(digest).toContain("/portal/dashboard");
    }
  });
});

// ---- 4. the owner notification when an invoice is created ---------------------
describe("the owner-facing invoice notification feed", () => {
  it("a new invoice appears in the owner's feed, only for the owner role", async () => {
    await seedInvoice({
      id: "inv-246-new",
      cycleMonth: "2026-10",
      dueDate: daysAheadIsoDate(20),
      status: "pending",
      createdAt: daysAgoIso(1),
      totalAmount: 500,
    });
    const feed = await recentActivityFeed(sunshineIid, ownerId);
    const invoicing = feed.filter((i) => i.id.startsWith("dinv-"));
    expect(invoicing).toHaveLength(1);
    expect(invoicing[0]!.type).toBe("billing");
    expect(invoicing[0]!.title).toBe("New invoice — 2026-10");
    expect(invoicing[0]!.link).toBe("/portal/account-billing");
    expect(invoicing[0]!.meta).toContain("Pending");
    expect(invoicing[0]!.body).toContain("500");
    expect(invoicing[0]!.body).toContain(daysAheadIsoDate(20));

    // The exact owner role is the audience: an admin/parent account sees no
    // daycare billing slice even for the same daycare.
    const admin = await createAccount({
      email: "feed-admin-246@sunshinedaycare.test",
      password: "feed-admin-1",
      fullName: "Feed Admin",
      role: "admin",
    });
    expect(
      (await recentActivityFeed(sunshineIid, String(admin.id))).filter((i) => i.id.startsWith("dinv-"))
    ).toHaveLength(0);
    const parent = String(
      (await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id
    );
    expect(
      (await recentActivityFeed(sunshineIid, parent)).filter((i) => i.id.startsWith("dinv-"))
    ).toHaveLength(0);
  });

  it("honors the notification_pref: a disabled billing/inapp pref suppresses the slice", async () => {
    await seedInvoice({
      id: "inv-246-pref",
      cycleMonth: "2026-10",
      dueDate: daysAheadIsoDate(20),
      status: "pending",
      createdAt: daysAgoIso(1),
    });
    expect(
      (await recentActivityFeed(sunshineIid, ownerId)).filter((i) => i.id.startsWith("dinv-"))
    ).toHaveLength(1);

    await setNotificationPref(ownerId, "billing", "inapp", false);
    expect(
      (await recentActivityFeed(sunshineIid, ownerId)).filter((i) => i.id.startsWith("dinv-"))
    ).toHaveLength(0);
    await setNotificationPref(ownerId, "billing", "inapp", true);
    expect(
      (await recentActivityFeed(sunshineIid, ownerId)).filter((i) => i.id.startsWith("dinv-"))
    ).toHaveLength(1);
  });

  it("warns while the owner can still act: due within 3 days and overdue", async () => {
    await seedInvoice({
      id: "inv-246-soon",
      // Fixed months: run-date-relative cycle months collide on the unique
      // (institute_id, cycle_month) index when the +2d and +10d dates cross
      // a month boundary (e.g. Oct 30: both land in November).
      cycleMonth: "2026-12",
      dueDate: daysAheadIsoDate(2),
      status: "pending",
      createdAt: daysAgoIso(30),
    });
    await seedInvoice({
      id: "inv-246-late",
      cycleMonth: "2026-09",
      dueDate: "2026-09-05",
      status: "overdue",
      createdAt: daysAgoIso(40),
    });
    // A 10-days-out pending invoice is not yet a warning (and not recent).
    // The cycle month is a fixed value that can never collide with the
    // soon-invoice's month above: when the test runs near a month end,
    // +2 days and +10 days land in the same calendar month and would
    // otherwise violate the (institute_id, cycle_month) UNIQUE constraint.
    // The feed logic under test keys off dueDate, not the cycle month.
    await seedInvoice({
      id: "inv-246-far",
      cycleMonth: "2030-01",
      dueDate: daysAheadIsoDate(10),
      status: "pending",
      createdAt: daysAgoIso(30),
    });
    const feed = await recentActivityFeed(sunshineIid, ownerId);
    const invoicing = feed.filter((i) => i.id.startsWith("dinv-"));
    const titles = invoicing.map((i) => i.title);
    expect(titles).toContain("Invoice due soon — 2026-12");
    expect(titles).toContain("Overdue invoice — 2026-09");
    // The overdue warning is not bound to the creation window: the 40-day-old
    // creation never flags "new" — it keeps warning until paid.
    expect(titles.filter((t) => t.startsWith("New invoice"))).toHaveLength(0);
    // Nothing to act on for the far-future invoice: it is not in the feed.
    expect(invoicing.filter((i) => i.id.includes("inv-246-far"))).toHaveLength(0);
    // The overdue item says WHY it matters (the daycare is blocked).
    const overdueItem = invoicing.find((i) => i.id.includes("inv-246-late"))!;
    expect(overdueItem.body).toContain("blocked while this stays unpaid");
    expect(overdueItem.meta).toContain("Overdue — pay now");
  });
});

// ---- 5. the best-effort owner email through the existing Supabase path --------
describe("the invoice creation email (best-effort, existing Supabase path)", () => {
  it("sends nothing without a provider configured — the feed is the channel", async () => {
    const { notifyInvoiceOwner } = await import("@/lib/invoice-notify");
    const outcome = await notifyInvoiceOwner({
      daycareName: "Sunshine Daycare",
      ownerEmail: "owner@sunshine.test",
      cycleMonth: "2026-10",
      totalAmount: 600,
      currency: "EGP",
      dueDate: "2026-11-05",
    });
    expect(outcome.status).toBe("pending");
    expect(outcome.detail).toContain("no mail provider");
  });

  it("the already-registered owner degrades honestly instead of re-pretending", async () => {
    const { notifyInvoiceOwner, isOwnerAlreadyRegisteredError } = await import("@/lib/invoice-notify");
    expect(isOwnerAlreadyRegisteredError({ message: "Email address has already been registered" })).toBe(true);
    expect(isOwnerAlreadyRegisteredError({ status: "422" })).toBe(true);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co";
    const invite = vi
      .fn()
      .mockResolvedValue({ data: {}, error: { message: "Email address has already been registered" } });
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ auth: { admin: { inviteUserByEmail: invite } } }),
    }));
    try {
      const outcome = await notifyInvoiceOwner({
        daycareName: "Sunshine Daycare",
        ownerEmail: "owner@sunshine.test",
        cycleMonth: "2026-10",
        totalAmount: 600,
        currency: "EGP",
        dueDate: "2026-11-05",
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.detail).toContain("already registered");
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      vi.doUnmock("@supabase/supabase-js");
    }
  });

  it("generateDueInvoices emails the owner(s), honoring the billing/email pref", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co";
    const invite = vi.fn().mockResolvedValue({ data: {}, error: null });
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ auth: { admin: { inviteUserByEmail: invite } } }),
    }));
    const res = await createDaycare({
      name: "Maple Grove Mail",
      ownerEmail: `mailer-${Math.random().toString(36).slice(2, 8)}@maplegrove.test`,
      ownerPassword: "maple-owner-1",
      ownerFullName: "Nadia Mail",
      billing: { plan: "monthly" },
    });
    try {
      // One ended cycle relative to the injected "today" — deterministic.
      await updateDaycareBilling(res.instituteId, { firstCycleStart: "2026-03-01" });

      expect(await generateDueInvoices(utcDate(2026, 4, 1))).toBe(1);
      // Exactly one owner account (createDaycare's owner), invited once.
      expect(invite).toHaveBeenCalledTimes(1);
      expect(invite.mock.calls[0]![0]).toBe(
        String((await queryGet("SELECT email FROM account WHERE id = ?", res.ownerAccountId))!.email)
      );
      const inv = (await listInvoices(res.instituteId))[0]!;
      const { buildInvoiceNotificationEmail } = await import("@/lib/invoice-notify");
      const mail = buildInvoiceNotificationEmail({
        daycareName: "Maple Grove Mail",
        ownerEmail: String(invite.mock.calls[0]![0]),
        cycleMonth: inv.cycleMonth,
        totalAmount: inv.totalAmount,
        currency: inv.currency,
        dueDate: inv.dueDate,
      });
      expect(mail.subject).toContain("New invoice");
      expect(mail.subject).toContain(inv.cycleMonth);
      expect(mail.text).toContain(inv.dueDate);
      expect(mail.text).toContain(String(inv.totalAmount));
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      vi.doUnmock("@supabase/supabase-js");
    }
  });

  it("a disabled billing/email pref skips the owner's email; the feed stays on", async () => {
    const res = await createDaycare({
      name: "Maple Grove NoMail",
      ownerEmail: `nomail-${Math.random().toString(36).slice(2, 8)}@maplegrove.test`,
      ownerPassword: "maple-owner-1",
      ownerFullName: "Nadia Quiet",
      billing: { plan: "monthly" },
    });
    await setNotificationPref(res.ownerAccountId, "billing", "email", false);
    await updateDaycareBilling(res.instituteId, { firstCycleStart: "2026-03-01" });

    // No provider configured, and no owner email should even be attempted —
    // the resolution path must skip before it logs a "pending" send.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await generateDueInvoices(utcDate(2026, 4, 1)).finally(() => warn.mockRestore());
    expect(warn).not.toHaveBeenCalled();

    // The in-app slice is derived from the ledger regardless of email prefs.
    const feed = await recentActivityFeed(res.instituteId, res.ownerAccountId);
    expect(feed.filter((i) => i.id.startsWith("dinv-")).length).toBeGreaterThan(0);
  });
});
