// KID-1204: regression for the /platform "Clear link" no-op (KID-738 D1).
//
// The old Clear button carried name="instapayUrl" value="" — the SAME field
// name as the pre-filled input. FormData.get returns the FIRST same-name
// entry, the input's stored URL, so the action re-saved the URL and showed
// the "saved" banner instead of clearing (qa-report KID-738, defect D1).
//
// The fix (mirroring the plan): the Clear button submits an explicit
// instapayIntent=clear entry that wins over the pre-filled input, and
// setPlatformInstapayAction treats that intent as a clear without ever
// consulting instapayUrl. Blank + Save unchanged.
//
// Pinned here (fail on the pre-fix code, pass on the fix):
//   1. The FormData the new Clear markup produces (instapayUrl = the stored
//      URL from the prefilled input + instapayIntent=clear) deletes the
//      platform_setting row and records the "Cleared" audit event — it never
//      re-saves the URL.
//   2. The rendered form carries the clear signal and exactly ONE
//      instapayUrl field (the input) — a second same-name entry from the
//      button was the bug's mechanism.
//   3. Blank + Save keeps clearing (KID-737's own path, untouched).
//   4. Saving via the input still works: no intent entry → the URL is parsed
//      and stored (the fix must not turn every save into a clear).
//   5. After clearing, the owner's /portal/account-billing hides the
//      Pay with Instapay button on unpaid invoices (the acceptance loop).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// --- request-scope mock (kid489/kid490 pattern): actions read cookies() for
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
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));
vi.mock("@/lib/supabase", () => ({
  supabaseConfigured: () => true,
  getSupabase: () => ({
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      getUser: async () => ({ data: {}, error: null }),
    },
  }),
}));
// KID-1177: lib/actions imports lib/storage — a minimal stand-in (same shape
// the KID-1177 helper mock uses) so nothing here touches a real bucket. Kept
// inline so this regression file carries no dependency on another ticket's
// uncommitted helper.
vi.mock("@/lib/storage", () => {
  const storageFrom = (bucket: string) => ({
    upload: async () => ({ error: null }),
    remove: async () => ({ error: null }),
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${bucket}/${path}` } }),
  });
  return {
    storageAdminConfigured: () => true,
    getStorageAdmin: () => ({ storage: { from: storageFrom } }),
    PUBLIC_BUCKET: "kiddy-public",
    PRIVATE_BUCKET: "kiddy-private",
    PRIVATE_REF_PREFIX: "kiddy-private:",
    privateRef: (path: string) => `kiddy-private:${path}`,
    publicUrl: async (path: string) => `https://storage.test/kiddy-public/${path}`,
    isPrivateRef: (value: unknown) => typeof value === "string" && value.startsWith("kiddy-private:"),
    privateRefPath: (value: string) => value.slice("kiddy-private:".length),
    SIGNED_URL_TTL_SECONDS: 3600,
    signedUrlForRef: async (ref: string) =>
      ref.startsWith("kiddy-private:")
        ? `https://storage.test/storage/v1/object/sign/kiddy-private/${ref.slice("kiddy-private:".length)}?token=signed`
        : null,
    storageSrcFor: async (stored: string | null | undefined) => (stored ? String(stored) : null),
    signedUrlsForRefs: async (refs: string[]) => new Map(refs.map((r) => [r, r] as const)),
  };
});

import { createSessionToken } from "@/lib/auth";
import { PLATFORM_INSTAPAY_KEY } from "@/lib/platform-settings";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let sunshineIid: string;
let ownerId: string;
let ownerEmail: string;
let superadminId: string;
const LINK = "https://instapay.eg/pay/kiddyapp";

function sessionCookieFor(accountId: string, role: string, email: string): void {
  const token = createSessionToken({ accountId, role, email, emailConfirmed: true });
  mockState.cookies = { kiddy_sess: token };
  mockState.cookie = `kiddy_sess=${token}`;
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

async function settingRow(): Promise<any> {
  return queryGet("SELECT value FROM platform_setting WHERE key = ?", PLATFORM_INSTAPAY_KEY);
}

async function storeLink(): Promise<void> {
  await queryRun(
    "INSERT INTO platform_setting (key, value, updated_by_account_id, updated_at) VALUES (?, ?, ?, datetime('now'))",
    PLATFORM_INSTAPAY_KEY,
    LINK,
    superadminId
  );
}

async function renderOwnerBilling(): Promise<string> {
  const { default: Page } = await import("@/app/portal/account-billing/page");
  return renderToStaticMarkup(await Page({ searchParams: {} }));
}

beforeEach(async () => {
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const owner = await queryGet("SELECT id, email FROM account WHERE role = 'owner'");
  ownerId = String(owner!.id);
  ownerEmail = String(owner!.email);
  const op = await queryGet("SELECT id FROM account WHERE email = 'superadmin@kiddy.test'");
  superadminId = String(op!.id);
});

describe("KID-1204: the Clear link button clears (KID-738 D1)", () => {
  it("the Clear click (prefilled input URL + instapayIntent=clear) deletes the stored link and records the clear", async () => {
    await storeLink();
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { setPlatformInstapayAction } = await import("@/lib/actions");
    // EXACTLY the FormData the fixed markup ships for a Clear click: the
    // pre-filled input carries the stored URL under instapayUrl (the first,
    // winning same-name entry in the old bug), the button carries the clear
    // intent under its own name.
    const form = new FormData();
    form.set("instapayUrl", LINK);
    form.set("instapayIntent", "clear");
    const target = await redirectTargetFor(() => setPlatformInstapayAction(form));
    expect(target).toBe("/platform?instapay=saved");
    // THE regression: the URL is gone, never re-saved.
    expect(await settingRow()).toBeUndefined();
    const audit = await queryGet(
      "SELECT summary, metadata FROM audit_event WHERE entity_type = 'platform_setting' ORDER BY created_at DESC LIMIT 1"
    );
    expect(String(audit!.summary ?? "")).toContain("Cleared the platform Instapay");
    expect(String(audit!.metadata ?? "")).toContain('"cleared":true');
  });

  it("the rendered form carries the clear signal and exactly ONE instapayUrl field (the input)", async () => {
    await storeLink();
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { default: Page } = await import("@/app/platform/page");
    const html = await renderToStaticMarkup(await Page({ searchParams: {} }));
    // The clear button signals through its own name/value…
    expect(html).toContain('name="instapayIntent"');
    expect(html).toContain('value="clear"');
    // …and never adds a second instapayUrl entry (the old button's
    // name="instapayUrl" value="" was the bug's mechanism).
    expect((html.match(/name="instapayUrl"/g) ?? []).length).toBe(1);
  });

  it("blank + Save still clears (the KID-737 path, no intent entry)", async () => {
    await storeLink();
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { setPlatformInstapayAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("instapayUrl", "");
    const target = await redirectTargetFor(() => setPlatformInstapayAction(form));
    expect(target).toBe("/platform?instapay=saved");
    expect(await settingRow()).toBeUndefined();
    const audit = await queryGet(
      "SELECT summary FROM audit_event WHERE entity_type = 'platform_setting' ORDER BY created_at DESC LIMIT 1"
    );
    expect(String(audit!.summary ?? "")).toContain("Cleared the platform Instapay");
  });

  it("a plain Save (input URL, no intent) still stores the URL — the fix is not clear-everything", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { setPlatformInstapayAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("instapayUrl", LINK);
    const target = await redirectTargetFor(() => setPlatformInstapayAction(form));
    expect(target).toBe("/platform?instapay=saved");
    const row = await settingRow();
    expect(String(row!.value)).toBe(LINK);
  });

  it("after clearing, the owner's Pay with Instapay button is hidden on unpaid invoices", async () => {
    await storeLink();
    await queryRun(
      `INSERT INTO daycare_invoice (id, institute_id, cycle_month, plan, max_active_children, billable_children,
         flat_rate_amount, incremental_rate, incremental_amount, total_amount, currency, due_date, status, created_at)
       VALUES ('inv-1204', ?, '2026-10', 'monthly', 12, 2, 500, 50, 100, 600, 'EGP', '2026-11-05', 'pending', datetime('now'))`,
      sunshineIid
    );
    sessionCookieFor(ownerId, "owner", ownerEmail);
    // Sanity: with the link set the owner sees the pay button…
    const before = await renderOwnerBilling();
    expect(before).toContain("Pay with Instapay");
    expect(before).toContain(LINK);
    // …the operator clears it exactly like the button does…
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { setPlatformInstapayAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("instapayUrl", LINK);
    form.set("instapayIntent", "clear");
    await redirectTargetFor(() => setPlatformInstapayAction(form));
    // …and the unpaid invoice no longer renders any pay link — no dead
    // URL and no "Pay with Instapay" button anywhere.
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const after = await renderOwnerBilling();
    expect(after).not.toContain("Pay with Instapay");
    expect(after).not.toContain(LINK);
    expect(after).toContain("not set a payment link");
  });
});
