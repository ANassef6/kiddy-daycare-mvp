// KID-489 item 2 (KID-491): the Instapay payment link.
//
// Pinned here, mirroring the ticket:
//   1. supabase/migrations/0033_instapay_payment_link.sql adds the optional
//      institute.instapay_url and child_billing.payment_link columns
//      (idempotent, no NOT NULL / DEFAULT write), mirrored in
//      lib/sqlite-schema.ts (the SQLite mirror is exercised for real below).
//   2. lib/instapay.ts parsePaymentLink: blank → NULL, absolute http/https
//      URLs accepted as given, anything else (ftp:, javascript:, relative
//      text) rejected.
//   3. Center settings: an admin saves a valid URL and it survives reload;
//      an invalid/non-http value is rejected with the ?error=instapay banner
//      and the column is untouched.
//   4. The new-invoice form prefills the center link, an explicit value
//      overrides it, a cleared field stores NULL, and an invalid value
//      refuses the whole create with the ?error=paymentlink banner.
//   5. The parent child surface renders the Pay with Instapay button (new
//      tab) only for invoices that carry a link, inside the KID-372
//      family-visibility gate — an unrelated parent cannot render another
//      family's child (and therefore payment link) at all.
//   6. Invoices without a link render unchanged (no button,	NULL column).
//   7. EN + AR labels ship for every new string.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

// --- request-scope mock (kid490/kid254 pattern): actions read cookies() for
// the session and headers() for the tenant; pages read the Cookie header ---
const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
  cookies: {} as Record<string, string>,
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    if (mockState.host) entries.host = mockState.host;
    return new Headers(entries);
  },
  cookies: () => ({
    get: (name: string) => (mockState.cookies[name] ? { name, value: mockState.cookies[name] } : undefined),
    set: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
    err.digest = `NEXT_REDIRECT;replace;${url};`;
    throw err;
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import * as store from "@/lib/store";
import { createSessionToken, createAccount } from "@/lib/auth";
import { parsePaymentLink } from "@/lib/instapay";
import { dictionaries } from "@/lib/i18n";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

const GOOD_LINK = "https://instapay.eg/pay/demo-daycare";

let sunshineIid: string;
let sunshineChildId: string;
let sunshineAdminId: string;
let parentId: string;

function formData(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

function sessionCookieFor(accountId: string, role: string, email: string): string {
  const token = createSessionToken({ accountId, role, email, emailConfirmed: true });
  mockState.cookies = { kiddy_sess: token };
  mockState.cookie = `kiddy_sess=${token}`;
  return mockState.cookie;
}

async function redirectTargetFor(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    throw new Error("expected a redirect");
  } catch (err) {
    const digest = String((err as Error & { digest?: string })?.digest ?? "");
    const m = /NEXT_REDIRECT;replace;([^;]+);/.exec(digest);
    if (m) return m[1];
    throw err;
  }
}

beforeEach(async () => {
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  sunshineChildId = String((await queryGet("SELECT id FROM child LIMIT 1"))!.id);
  sunshineAdminId = String((await queryGet("SELECT id FROM account WHERE email = 'trois4ever+admin@gmail.com'"))!.id);
  parentId = String((await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id);
});

describe("KID-491: parsePaymentLink", () => {
  it("accepts absolute http/https URLs as given", () => {
    expect(parsePaymentLink(" https://instapay.eg/pay/sunshine ")).toEqual({ ok: true, value: "https://instapay.eg/pay/sunshine" });
    expect(parsePaymentLink("http://example.com/link")).toEqual({ ok: true, value: "http://example.com/link" });
  });

  it("blanks and missing values mean no link (NULL), not a broken URL", () => {
    expect(parsePaymentLink("")).toEqual({ ok: true, value: null });
    expect(parsePaymentLink("   ")).toEqual({ ok: true, value: null });
    expect(parsePaymentLink(null)).toEqual({ ok: true, value: null });
    expect(parsePaymentLink(undefined)).toEqual({ ok: true, value: null });
  });

  it("rejects non-http schemes and garbage", () => {
    expect(parsePaymentLink("javascript:alert(1)")).toEqual({ ok: false, code: "invalid" });
    expect(parsePaymentLink("ftp://files.example.com/x")).toEqual({ ok: false, code: "invalid" });
    expect(parsePaymentLink("not a url at all")).toEqual({ ok: false, code: "invalid" });
    expect(parsePaymentLink("instapay.eg/pay/x")).toEqual({ ok: false, code: "invalid" });
  });
});

describe("KID-491: schema (Postgres migration mirrored in SQLite)", () => {
  it("the migration adds both optional link columns idempotently", () => {
    const sql = readFileSync("supabase/migrations/0033_instapay_payment_link.sql", "utf8");
    expect(sql).toMatch(/ALTER TABLE institute ADD COLUMN IF NOT EXISTS instapay_url TEXT/i);
    expect(sql).toMatch(/ALTER TABLE child_billing ADD COLUMN IF NOT EXISTS payment_link TEXT/i);
  });

  it("the SQLite mirror carries the columns; fresh rows read no link", async () => {
    const inst = await queryGet("SELECT instapay_url FROM institute WHERE id = ?", sunshineIid);
    expect(inst!.instapay_url).toBeNull();
    const billing = await store.createChildBilling({
      childId: sunshineChildId,
      instituteId: sunshineIid,
      description: "Schema mirror probe",
      amountCents: 1000,
    });
    const row = await queryGet("SELECT payment_link FROM child_billing WHERE id = ?", String(billing.id));
    expect(row!.payment_link).toBeNull();
  });
});

describe("KID-491: center settings Instapay link", () => {
  it("an admin saves a valid URL and it survives reload", async () => {
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const { saveCenterDetailsAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      saveCenterDetailsAction(formData({ name: "Sunshine Daycare", contact: "", address: "", instapayUrl: GOOD_LINK }))
    );
    expect(target).toBe("/portal/settings");
    const after = await queryGet("SELECT instapay_url FROM institute WHERE id = ?", sunshineIid);
    expect(String(after!.instapay_url)).toBe(GOOD_LINK);
    // reload → the settings page renders the saved link back into the field
    const { default: Page } = await import("@/app/portal/settings/page");
    const html = renderToStaticMarkup(await Page({ searchParams: {} }) as never);
    expect(html).toContain(`value="${GOOD_LINK}"`);
  });

  it("an invalid value is rejected with the error banner and nothing is stored", async () => {
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const { saveCenterDetailsAction } = await import("@/lib/actions");
    await queryRun("UPDATE institute SET instapay_url = 'https://instapay.eg/old' WHERE id = ?", sunshineIid);
    for (const bad of ["ftp://x", "not-a-url"]) {
      const target = await redirectTargetFor(() =>
        saveCenterDetailsAction(formData({ name: "Sunshine Daycare", contact: "", address: "", instapayUrl: bad }))
      );
      expect(target).toBe("/portal/settings?error=instapay");
    }
    const after = await queryGet("SELECT instapay_url FROM institute WHERE id = ?", sunshineIid);
    expect(String(after!.instapay_url)).toBe("https://instapay.eg/old");
    const { default: Page } = await import("@/app/portal/settings/page");
    const html = renderToStaticMarkup(await Page({ searchParams: { error: "instapay" } }) as never);
    expect(html).toContain(dictionaries.en.settings.instapayLinkInvalid);
  });

  it("clearing the field removes the center link", async () => {
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const { saveCenterDetailsAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      saveCenterDetailsAction(formData({ name: "Sunshine Daycare", contact: "", address: "", instapayUrl: GOOD_LINK }))
    );
    await redirectTargetFor(() =>
      saveCenterDetailsAction(formData({ name: "Sunshine Daycare", contact: "", address: "", instapayUrl: "" }))
    );
    const after = await queryGet("SELECT instapay_url FROM institute WHERE id = ?", sunshineIid);
    expect(after!.instapay_url).toBeNull();
  });
});
describe("KID-491: the invoice create form prefill, override and persistence", () => {
  it("the form prefills the center's Instapay link", async () => {
    await queryRun("UPDATE institute SET instapay_url = ? WHERE id = ?", GOOD_LINK, sunshineIid);
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const { default: Page } = await import("@/app/portal/children/[id]/billing/page");
    const html = renderToStaticMarkup(await Page({ params: { id: sunshineChildId } }) as never);
    expect(html).toContain(`value="${GOOD_LINK}"`);
  });

  it("an explicit per-invoice link is stored and can override the center default", async () => {
    await queryRun("UPDATE institute SET instapay_url = 'https://instapay.eg/center-default' WHERE id = ?", sunshineIid);
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const { addChildBillingAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      addChildBillingAction(
        formData({
          childId: sunshineChildId,
          description: "March fees",
          amountCents: "95000",
          paymentLink: GOOD_LINK,
        })
      )
    );
    const row = await queryGet("SELECT payment_link FROM child_billing WHERE child_id = ? ORDER BY created_at DESC LIMIT 1", sunshineChildId);
    expect(String(row!.payment_link)).toBe(GOOD_LINK);
  });

  it("a cleared prefill stores an invoice WITHOUT a link", async () => {
    await queryRun("UPDATE institute SET instapay_url = ? WHERE id = ?", GOOD_LINK, sunshineIid);
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const { addChildBillingAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      addChildBillingAction(formData({ childId: sunshineChildId, description: "April fees", amountCents: "95000", paymentLink: "" }))
    );
    const row = await queryGet("SELECT payment_link FROM child_billing WHERE child_id = ? ORDER BY created_at DESC LIMIT 1", sunshineChildId);
    expect(row!.payment_link).toBeNull();
  });

  it("an invalid link refuses the whole create with the banner redirect", async () => {
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const { addChildBillingAction } = await import("@/lib/actions");
    for (const bad of ["javascript:alert(1)", "instapay no scheme"]) {
      const target = await redirectTargetFor(() =>
        addChildBillingAction(formData({ childId: sunshineChildId, description: "Bad link", amountCents: "100", paymentLink: bad }))
      );
      expect(target).toBe(`/portal/children/${sunshineChildId}/billing?error=paymentlink`);
    }
    const rows = await store.listChildBilling(sunshineChildId);
    expect(rows.some((r: any) => r.description === "Bad link")).toBe(false);
  });
});

describe("KID-491: the parent sees only their own invoices, with a working payment link", () => {
  it("an invoice with a link renders the Pay with Instapay button in a new tab", async () => {
    await store.createChildBilling({
      childId: sunshineChildId,
      instituteId: sunshineIid,
      description: "January fees",
      amountCents: 150000,
      currency: "EGP",
      paymentLink: GOOD_LINK,
    });
    sessionCookieFor(parentId, "parent", "parent@example.test");
    const { default: ParentPage } = await import("@/app/child/[id]/page");
    const html = renderToStaticMarkup(await ParentPage({ params: { id: sunshineChildId }, searchParams: {} }) as never);
    expect(html).toContain(`href="${GOOD_LINK}"`);
    expect(html).toContain(`target="_blank"`);
    expect(html).toContain(dictionaries.en.child.payWithInstapay);
  });

  it("an invoice without a link renders unchanged — no Pay button", async () => {
    const billing = await store.createChildBilling({
      childId: sunshineChildId,
      instituteId: sunshineIid,
      description: "Legacy invoice",
      amountCents: 5000,
    });
    sessionCookieFor(parentId, "parent", "parent@example.test");
    const { default: ParentPage } = await import("@/app/child/[id]/page");
    const html = renderToStaticMarkup(await ParentPage({ params: { id: sunshineChildId }, searchParams: {} }) as never);
    expect(html).not.toContain(`target="_blank"`);
    expect(html).toContain("Legacy invoice");
    void billing;
  });

  it("tenant isolation: a parent with no family link to the child never renders that child or its payment link", async () => {
    await store.createChildBilling({
      childId: sunshineChildId,
      instituteId: sunshineIid,
      description: "Secret fees",
      amountCents: 99000,
      paymentLink: "https://instapay.eg/pay/sunshine-secret",
    });
    const outsider = await createAccount({
      email: "kid491-outsider@example.test",
      password: "kiddy-parent",
      fullName: "Outsider Parent",
      role: "parent",
    });
    sessionCookieFor(String(outsider.id), "parent", "kid491-outsider@example.test");
    const { default: ParentPage } = await import("@/app/child/[id]/page");
    await expect(ParentPage({ params: { id: sunshineChildId }, searchParams: {} })).rejects.toThrow(/NEXT_NOT_FOUND/);
  });

  it("the portal admin billing table lists the link (center staff can verify)", async () => {
    await store.createChildBilling({
      childId: sunshineChildId,
      instituteId: sunshineIid,
      description: "Linked fees",
      amountCents: 1000,
      paymentLink: GOOD_LINK,
    });
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const { default: Page } = await import("@/app/portal/children/[id]/billing/page");
    const html = renderToStaticMarkup(await Page({ params: { id: sunshineChildId } }) as never);
    expect(html).toContain(`href="${GOOD_LINK}"`);
  });
});

describe("KID-491: EN + AR labels", () => {
  it("ships both dictionaries for every new string", () => {
    expect(dictionaries.en.settings.instapayLink).toBe("Instapay link (optional)");
    expect(dictionaries.ar.settings.instapayLink).toContain("Instapay");
    expect(dictionaries.en.profile.paymentLink).toContain("Payment link");
    expect(dictionaries.ar.profile.paymentLink).toContain("Instapay");
    expect(dictionaries.en.child.payWithInstapay).toContain("Pay with Instapay");
    expect(dictionaries.ar.child.payWithInstapay).toContain("Instapay");
    expect(dictionaries.en.settings.instapayLinkInvalid).toContain("http");
    expect(dictionaries.ar.settings.instapayLinkInvalid).toContain("http");
  });
});
