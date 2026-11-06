// KID-489 item 1 (KID-490): the center-level default currency.
//
// Pinned here, mirroring the ticket:
//   1. One central supported-currency list (lib/currency.ts) — EGP first
//      (the platform's operating currency), and every currency selector /
//      fallback in the app reads from it instead of hardcoded AED/CAD.
//   2. supabase/migrations/0032_center_default_currency.sql adds
//      institute.default_currency DEFAULT 'EGP', mirrored in
//      lib/sqlite-schema.ts (the SQLite mirror is exercised for real below).
//   3. saveCenterDetailsAction persists the "Default currency" select from
//      Center details; an out-of-list value clamps to the platform default.
//   4. A new child invoice defaults to the center's currency (tested for both
//      EGP and USD); an existing invoice keeps its stored currency.
//   5. EN + AR labels ship for the new field.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// --- request-scope mock (kid372 pattern): actions read cookies() for the
// session and headers() for the tenant; redirect() throws the sentinel so a
// refusal/landing fails loudly instead of rendering. ---
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
  };
});

import * as store from "@/lib/store";
import { createSessionToken } from "@/lib/auth";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, normalizeCurrency } from "@/lib/currency";
import { dictionaries } from "@/lib/i18n";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let sunshineIid: string;
let sunshineChildId: string;
let sunshineAdminId: string;

function formData(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

function sessionFor(accountId: string, email: string, role: string): void {
  sessionCookie.value = createSessionToken({ accountId, email, role, emailConfirmed: true });
}

async function redirectTargetFor(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    throw new Error("expected a redirect");
  } catch (err) {
    const digest = String((err as Error & { digest?: string })?.digest ?? "");
    const m = /NEXT_REDIRECT;replace;([^;]+);/.exec(digest);
    if (m) return m[1];
    const msg = String((err as Error)?.message ?? "");
    if (msg.startsWith("NEXT_REDIRECT: ")) return msg.slice("NEXT_REDIRECT: ".length);
    throw err;
  }
}

beforeEach(async () => {
  sessionCookie.value = "";
  mockHeaders = {};
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  sunshineChildId = String((await queryGet("SELECT id FROM child LIMIT 1"))!.id);
  sunshineAdminId = String((await queryGet("SELECT id FROM account WHERE email = 'trois4ever+admin@gmail.com'"))!.id);
});

describe("KID-490: central currency list", () => {
  it("contains EGP and the full supported set, with EGP as the platform default", () => {
    expect([...SUPPORTED_CURRENCIES]).toEqual(["EGP", "AED", "USD", "CAD", "GBP", "EUR", "SAR"]);
    expect(DEFAULT_CURRENCY).toBe("EGP");
    expect(SUPPORTED_CURRENCIES.includes("EGP" as (typeof SUPPORTED_CURRENCIES)[number])).toBe(true);
  });

  it("normalizeCurrency trims/uppercases, keeps supported codes, clamps unknown ones", () => {
    expect(normalizeCurrency(" egp ")).toBe("EGP");
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("", "USD")).toBe("USD");
    expect(normalizeCurrency(null, "AED")).toBe("AED");
    expect(normalizeCurrency("XXX")).toBe("EGP");
    expect(normalizeCurrency("XXX", "NOT-A-CODE")).toBe("EGP");
    expect(normalizeCurrency(undefined)).toBe("EGP");
  });
});

describe("KID-490: schema (Postgres migration mirrored in SQLite)", () => {
  it("the migration adds institute.default_currency DEFAULT 'EGP'", () => {
    const sql = readFileSync("supabase/migrations/0032_center_default_currency.sql", "utf8");
    expect(sql).toMatch(/ALTER TABLE institute/i);
    expect(sql).toMatch(/default_currency TEXT NOT NULL DEFAULT 'EGP'/);
  });

  it("the SQLite mirror carries the column and a fresh center reads EGP", async () => {
    const inst = await queryGet("SELECT default_currency FROM institute WHERE id = ?", sunshineIid);
    expect(String(inst!.default_currency)).toBe("EGP");
  });
});

describe("KID-490: i18n labels", () => {
  it("ships the Default currency label in EN and AR", () => {
    expect(dictionaries.en.settings.defaultCurrency).toBe("Default currency");
    expect(dictionaries.ar.settings.defaultCurrency).toBe("العملة الافتراضية");
  });
});

describe("KID-490: saveCenterDetailsAction — the Center details dropdown persists", () => {
  it("an owner saves the default currency, reloads, and sees it retained", async () => {
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { saveCenterDetailsAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      saveCenterDetailsAction(
        formData({ name: "Sunshine Daycare", contact: "", address: "", defaultCurrency: "USD" })
      )
    );
    expect(target).toBe("/portal/settings");
    const after = await queryGet("SELECT default_currency FROM institute WHERE id = ?", sunshineIid);
    expect(String(after!.default_currency)).toBe("USD");
  });

  it("an out-of-list value clamps to the platform default instead of being stored raw", async () => {
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { saveCenterDetailsAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      saveCenterDetailsAction(
        formData({ name: "Sunshine Daycare", contact: "", address: "", defaultCurrency: "BTC" })
      )
    );
    const after = await queryGet("SELECT default_currency FROM institute WHERE id = ?", sunshineIid);
    expect(String(after!.default_currency)).toBe("EGP");
  });
});

describe("KID-490: new child invoices follow the center default", () => {
  it("defaults to EGP while the center default is EGP", async () => {
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { addChildBillingAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      addChildBillingAction(
        formData({ childId: sunshineChildId, description: "January fees", amountCents: "150000", currency: "" })
      )
    );
    const row = await queryGet(
      "SELECT currency FROM child_billing WHERE child_id = ? ORDER BY created_at DESC LIMIT 1",
      sunshineChildId
    );
    expect(String(row!.currency)).toBe("EGP");
  });

  it("defaults to USD after the admin changes the center default to USD", async () => {
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    await queryRun("UPDATE institute SET default_currency = 'USD' WHERE id = ?", sunshineIid);
    const { addChildBillingAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      addChildBillingAction(formData({ childId: sunshineChildId, description: "February fees", amountCents: "20000" }))
    );
    const row = await queryGet(
      "SELECT currency FROM child_billing WHERE child_id = ? ORDER BY created_at DESC LIMIT 1",
      sunshineChildId
    );
    expect(String(row!.currency)).toBe("USD");
  });

  it("an existing invoice keeps its stored currency when the default changes", async () => {
    const cad = await store.createChildBilling({
      childId: sunshineChildId,
      instituteId: sunshineIid,
      description: "Legacy invoice",
      amountCents: 5000,
      currency: "CAD",
    });
    await queryRun("UPDATE institute SET default_currency = 'EGP' WHERE id = ?", sunshineIid);
    const fresh = await store.createChildBilling({
      childId: sunshineChildId,
      instituteId: sunshineIid,
      description: "New invoice, no currency given",
      amountCents: 7000,
    });
    const after = await queryGet("SELECT currency FROM child_billing WHERE id = ?", String(cad.id));
    expect(String(after!.currency)).toBe("CAD");
    const freshRow = await queryGet("SELECT currency FROM child_billing WHERE id = ?", String(fresh.id));
    expect(String(freshRow!.currency)).toBe("EGP");
  });

  it("an explicit per-invoice currency choice still wins over the center default", async () => {
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { addChildBillingAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      addChildBillingAction(
        formData({ childId: sunshineChildId, description: "Paid abroad", amountCents: "9000", currency: "GBP" })
      )
    );
    const row = await queryGet(
      "SELECT currency FROM child_billing WHERE child_id = ? ORDER BY created_at DESC LIMIT 1",
      sunshineChildId
    );
    expect(String(row!.currency)).toBe("GBP");
  });
});
