// KID-737: the platform Instapay link + the daycare owner's subscription
// payment-proof upload.
//
// Pinned here, mirroring the ticket:
//   1. supabase/migrations/0037_kid737_platform_payment.sql: the
//      platform_setting table + three nullable daycare_invoice proof columns,
//      idempotent, mirrored in lib/sqlite-schema.ts.
//   2. lib/instapay.ts parsePaymentLink at the platform boundary: blank
//      clears, absolute http/https stored as given, anything else
//      (javascript:, ftp:, relative, garbage, schemeless) refused.
//   3. setPlatformInstapayAction: operator-only (a non-operator POST is
//      bounced to /login), a valid https link stored + attributed audit
//      event, a broken link refused with nothing stored, blank clears the
//      setting (row deleted + "cleared" audit event).
//   4. uploadDaycareInvoiceProofAction: an owner uploads for their OWN
//      daycare's unpaid invoice — URL + uploaded_at + optional reference
//      stored, the invoice status NEVER moves, a replacement upload replaces
//      the whole snapshot, markInvoicePaid clears nothing. Refused
//      fail-closed: a non-owner role, a foreign daycare's invoice id, a paid
//      invoice, oversize/wrong-type files (before any write), storage
//      failure (?proofError=proofUpload, nothing written).
//   5. The surfaces: the owner's /portal/account-billing renders the Pay
//      with Instapay link only when the platform set one (never a dead
//      link), the upload form per unpaid invoice (replace wording once a
//      proof exists), the supplier-side hint when no link is set; the
//      /platform invoice list shows the proof view link + upload date +
//      reference for both unpaid and paid rows.
//   6. EN + AR labels ship for every new string (the dicts stay key-aligned).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

// --- request-scope mock (kid489/kid490 pattern): actions read cookies() for
// the session and headers() for the tenant; pages read the Cookie header ---
const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
  cookies: {} as Record<string, string>,
  // Injects a storage failure for the ?proofError=proofUpload path.
  uploadError: null as { message: string } | null,
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
// KID-1177: proof uploads ride the service-key client into kiddy-private and
// the row keeps the private REF; render sites mint signed URLs (stand-in:
// tests/helpers/kid1177-storage.ts).
vi.mock("@/lib/storage", async () => (await import("../helpers/kid1177-storage")).kid1177StorageMock);
import { storage1177 } from "../helpers/kid1177-storage";

import { createSessionToken, createAccount } from "@/lib/auth";
import { MAX_PAYMENT_PROOF_BYTES, validatePaymentProof } from "@/lib/payment-proof";
import { parsePaymentLink } from "@/lib/instapay";
import { PLATFORM_INSTAPAY_KEY } from "@/lib/platform-settings";
import { dictionaries, keysOf } from "@/lib/i18n";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let sunshineIid: string;
let ownerId: string;
let ownerEmail: string;
let superadminId: string;

function formWith(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

function fileFor(size: number, type: string, name: string): File {
  // size 0 is meaningful here: an empty file must read as size 0.
  return new File([new Uint8Array(size)], name, { type });
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

// Seeds one daycare_invoice row (the kid245/kid246 raw pattern).
async function seedInvoice(args: {
  id: string;
  cycleMonth: string;
  dueDate: string;
  status: "pending" | "paid" | "overdue";
}): Promise<void> {
  await queryRun(
    `INSERT INTO daycare_invoice
       (id, institute_id, cycle_month, plan, max_active_children, billable_children,
        flat_rate_amount, incremental_rate, incremental_amount, total_amount, currency,
        due_date, status, created_at)
     VALUES (?, ?, ?, 'monthly', 12, 2, 500, 50, 100, 600, 'EGP', ?, ?, datetime('now'))`,
    args.id,
    sunshineIid,
    args.cycleMonth,
    args.dueDate,
    args.status
  );
}

async function proofRowFor(invoiceId: string): Promise<any> {
  return queryGet(
    "SELECT payment_proof_url, payment_proof_uploaded_at, payment_reference, status FROM daycare_invoice WHERE id = ?",
    invoiceId
  )!;
}

beforeEach(async () => {
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  mockState.uploadError = null;
  storage1177.uploadError = null;
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const owner = await queryGet("SELECT id, email FROM account WHERE role = 'owner'");
  ownerId = String(owner!.id);
  ownerEmail = String(owner!.email);
  const op = await queryGet("SELECT id FROM account WHERE email = 'superadmin@kiddy.test'");
  superadminId = String(op!.id);
});

// ---- 1. schema ---------------------------------------------------------------
describe("KID-737: schema (Postgres migration mirrored in SQLite)", () => {
  it("the migration adds the platform_setting table and the three proof columns idempotently", () => {
    const sql = readFileSync("supabase/migrations/0037_kid737_platform_payment.sql", "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS platform_setting/i);
    expect(sql).toMatch(/ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS payment_proof_url TEXT/i);
    expect(sql).toMatch(/ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at TEXT/i);
    expect(sql).toMatch(/ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS payment_reference TEXT/i);
  });

  it("the SQLite mirror carries the columns; a fresh invoice reads all NULL", async () => {
    await seedInvoice({ id: "inv-737-mirror", cycleMonth: "2026-10", dueDate: "2026-11-05", status: "pending" });
    const row = await proofRowFor("inv-737-mirror");
    expect(row.payment_proof_url).toBeNull();
    expect(row.payment_proof_uploaded_at).toBeNull();
    expect(row.payment_reference).toBeNull();
    expect(String(row.status)).toBe("pending");
    // The platform_setting table exists and starts with no instapay row.
    const setting = await queryGet("SELECT value FROM platform_setting WHERE key = ?", PLATFORM_INSTAPAY_KEY);
    expect(setting).toBeUndefined();
  });
});

// ---- 2. the link boundary ----------------------------------------------------
describe("KID-737: the platform link boundary (parsePaymentLink)", () => {
  it("stores only absolute http/https links", () => {
    expect(parsePaymentLink("https://instapay.eg/pay/kiddyapp")).toEqual({
      ok: true,
      value: "https://instapay.eg/pay/kiddyapp",
    });
    expect(parsePaymentLink("http://example.com/link")).toEqual({ ok: true, value: "http://example.com/link" });
  });

  it("a blank value clears the setting", () => {
    for (const blank of ["", "   ", null, undefined]) {
      expect(parsePaymentLink(blank)).toEqual({ ok: true, value: null });
    }
  });

  it("anything else is refused before it can ever be stored", () => {
    for (const bad of [
      "javascript:alert(1)",
      "ftp://files.example.com/x",
      "instapay.eg/pay/x",
      "/relative/path",
      "not a url at all",
    ]) {
      expect(parsePaymentLink(bad)).toEqual({ ok: false, code: "invalid" });
    }
    // The file-upload boundary stays separate: a proof is PNG/JPG/PDF ≤ 5 MB.
    expect(validatePaymentProof({ type: "image/gif", size: 10 })).toEqual({ ok: false, code: "type" });
    expect(validatePaymentProof({ type: "image/png", size: MAX_PAYMENT_PROOF_BYTES + 1 })).toEqual({
      ok: false,
      code: "size",
    });
  });
});

// ---- 3. the operator's link card --------------------------------------------
describe("KID-737: setPlatformInstapayAction (operator-only)", () => {
  async function settingRow(): Promise<any> {
    return queryGet(
      `SELECT value, updated_by_account_id FROM platform_setting WHERE key = ?`,
      PLATFORM_INSTAPAY_KEY
    );
  }

  it("saves an https link, beats it into the audit trail with the operator attached", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { setPlatformInstapayAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      setPlatformInstapayAction(formWith({ instapayUrl: "https://instapay.eg/pay/kiddyapp" }))
    );
    expect(target).toBe("/platform?instapay=saved");
    const row = await settingRow();
    expect(String(row!.value)).toBe("https://instapay.eg/pay/kiddyapp");
    expect(String(row!.updated_by_account_id)).toBe(superadminId);
    const audit = await queryGet(
      "SELECT summary, metadata FROM audit_event WHERE entity_type = 'platform_setting' ORDER BY created_at DESC LIMIT 1"
    );
    expect(String(audit!.summary ?? "")).toContain("Set the platform Instapay");
    expect(String(audit!.metadata ?? "")).not.toContain("instapay.eg");
  });

  it("a broken link is refused with a localized banner and nothing is stored", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { setPlatformInstapayAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      setPlatformInstapayAction(formWith({ instapayUrl: "javascript:alert(1)" }))
    );
    expect(target).toBe("/platform?instapay=invalid");
    // A refusal leaves whichever earlier value was stored exactly in place.
    expect(await settingRow()).toBeUndefined();
    const target2 = await redirectTargetFor(() =>
      setPlatformInstapayAction(formWith({ instapayUrl: "shell-sale" }))
    );
    expect(target2).toBe("/platform?instapay=invalid");
    expect(await settingRow()).toBeUndefined();
  });

  it("blank clears the stored link (row deleted) and records the clear", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { setPlatformInstapayAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => setPlatformInstapayAction(formWith({ instapayUrl: "" })));
    expect(target).toBe("/platform?instapay=saved");
    expect(await settingRow()).toBeUndefined();
    const audit = await queryGet(
      "SELECT summary, metadata FROM audit_event WHERE entity_type = 'platform_setting' ORDER BY created_at DESC LIMIT 1"
    );
    expect(String(audit!.summary ?? "")).toContain("Cleared the platform Instapay");
    expect(String(audit!.metadata ?? "")).toContain('"cleared":true');
  });

  it("a non-operator POST is bounced to /login and stores nothing", async () => {
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const { setPlatformInstapayAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      setPlatformInstapayAction(formWith({ instapayUrl: "https://attacker.example/link" }))
    );
    expect(target).toBe("/login");
    expect(await settingRow()).toBeUndefined();
  });

  it("an anonymous POST lands on /login too", async () => {
    const { setPlatformInstapayAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      setPlatformInstapayAction(formWith({ instapayUrl: "https://attacker.example/link" }))
    );
    expect(target).toBe("/login");
    expect(await settingRow()).toBeUndefined();
  });
});

// ---- 4. the owner's proof upload --------------------------------------------
describe("KID-737: uploadDaycareInvoiceProofAction (owner-only)", () => {
  async function uploadProof(invoiceId: string, opts?: { type?: string; size?: number; reference?: string }): Promise<string> {
    const { uploadDaycareInvoiceProofAction } = await import("@/lib/actions");
    const form = formWith({
      invoiceId,
      ...(opts?.reference ? { paymentReference: opts.reference } : {}),
    });
    form.set("file", fileFor(opts?.size ?? 120, opts?.type ?? "image/png", "receipt.png"));
    return redirectTargetFor(() => uploadDaycareInvoiceProofAction(form));
  }

  it("stores the proof for the daycare's own pending invoice — status untouched", async () => {
    await seedInvoice({ id: "inv-737-a", cycleMonth: "2026-10", dueDate: "2026-11-05", status: "pending" });
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const target = await uploadProof("inv-737-a", { reference: "TX-7371" });
    expect(target).toBe("/portal/account-billing?proof=uploaded");
    const row = await proofRowFor("inv-737-a");
    expect(String(row.payment_proof_url)).toMatch(
      /^kiddy-private:payments\/[^/]+\/inv-737-a\/proof-\d+-[0-9a-f-]+\.png$/
    );
    // KID-1177: the object went to the private bucket through the service key.
    expect(storage1177.uploads.every((u) => u.bucket === "kiddy-private")).toBe(true);
    expect(String(row.payment_proof_uploaded_at ?? "")).not.toBe("");
    expect(String(row.payment_reference)).toBe("TX-7371");
    // THE rule: an upload never pays an invoice — the operator stays the
    // only status writer.
    expect(String(row.status)).toBe("pending");
    // The audit trail carries the marker, never the URL data.
    const audit = await queryGet(
      "SELECT summary, metadata FROM audit_event WHERE entity_type = 'daycare_invoice' AND entity_id = ?",
      "inv-737-a"
    );
    expect(String(audit!.summary ?? "")).toContain("Payment proof");
    expect(String(audit!.metadata ?? "")).not.toContain("storage.test");
  });

  it("an overdue invoice accepts a proof too", async () => {
    await seedInvoice({ id: "inv-737-od", cycleMonth: "2026-09", dueDate: "2026-10-05", status: "overdue" });
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const target = await uploadProof("inv-737-od");
    expect(target).toBe("/portal/account-billing?proof=uploaded");
    expect(String((await proofRowFor("inv-737-od")).status)).toBe("overdue");
  });

  it("a replacement upload replaces the whole snapshot before payment", async () => {
    await seedInvoice({ id: "inv-737-r", cycleMonth: "2026-10", dueDate: "2026-11-05", status: "pending" });
    sessionCookieFor(ownerId, "owner", ownerEmail);
    await uploadProof("inv-737-r", { reference: "TX-1" });
    const first = await proofRowFor("inv-737-r");
    await uploadProof("inv-737-r", { reference: "TX-2", type: "application/pdf" });
    const second = await proofRowFor("inv-737-r");
    expect(String(second.payment_reference)).toBe("TX-2");
    expect(String(second.payment_proof_url).endsWith(".pdf")).toBe(true);
    expect(String(second.payment_proof_url)).not.toBe(String(first.payment_proof_url));
  });

  it("a paid invoice refuses an upload, fail-closed before any write", async () => {
    await seedInvoice({ id: "inv-737-paid", cycleMonth: "2026-08", dueDate: "2026-09-05", status: "paid" });
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const target = await uploadProof("inv-737-paid");
    expect(target).toBe("/portal/account-billing?proofError=paid");
    const row = await proofRowFor("inv-737-paid");
    expect(row.payment_proof_url).toBeNull();
    // And marking it paid clears nothing silently — the proof (when one was
    // uploaded before payment) stays visible for history.
    const { markInvoicePaid } = await import("@/lib/billing");
    await queryRun(
      "UPDATE daycare_invoice SET payment_proof_url = 'https://storage.test/old-proof.png' WHERE id = 'inv-737-paid'"
    );
    await markInvoicePaid("inv-737-paid");
    const after = await proofRowFor("inv-737-paid");
    expect(String(after.payment_proof_url)).toBe("https://storage.test/old-proof.png");
  });

  it("a non-owner role (staff) is refused with no leak and no write", async () => {
    await seedInvoice({ id: "inv-737-staff", cycleMonth: "2026-10", dueDate: "2026-11-05", status: "pending" });
    const staffAcc = await createAccount({
      email: "kid737-staff@example.test",
      password: "kiddy-staff1",
      fullName: "Staffer K737",
      role: "staff",
    });
    sessionCookieFor(String(staffAcc.id), "staff", "kid737-staff@example.test");
    const target = await uploadProof("inv-737-staff");
    expect(target).toBe("/login?error=wrong-tenant");
    const row = await proofRowFor("inv-737-staff");
    expect(row.payment_proof_url).toBeNull();
  });

  it("another daycare's invoice id is refused for a real owner session", async () => {
    await queryRun(
      "INSERT INTO institute (id, name, created_at) VALUES (?, ?, datetime('now'))",
      "iid-kid737-maple",
      "Maple Daycare"
    );
    const foreign = "inv-737-maple";
    await queryRun(
      `INSERT INTO daycare_invoice (id, institute_id, cycle_month, due_date, status)
       VALUES (?, 'iid-kid737-maple', '2026-10', '2026-11-05', 'pending')`,
      foreign
    );
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const target = await uploadProof(foreign);
    expect(target).toBe("/login?error=wrong-tenant");
    const row = await proofRowFor(foreign);
    expect(row.payment_proof_url).toBeNull();
  });

  it("oversize, wrong-type and storage failures write nothing", async () => {
    await seedInvoice({ id: "inv-737-f", cycleMonth: "2026-10", dueDate: "2026-11-05", status: "pending" });
    sessionCookieFor(ownerId, "owner", ownerEmail);
    expect(await uploadProof("inv-737-f", { size: MAX_PAYMENT_PROOF_BYTES + 1 })).toBe(
      "/portal/account-billing?proofError=proofSize"
    );
    expect(await uploadProof("inv-737-f", { type: "text/plain" })).toBe(
      "/portal/account-billing?proofError=proofType"
    );
    expect(await uploadProof("inv-737-f", { size: 0 })).toBe(
      "/portal/account-billing?proofError=proofType"
    );
    mockState.uploadError = { message: "boom" };
    storage1177.uploadError = { message: "boom" };
    expect(await uploadProof("inv-737-f")).toBe("/portal/account-billing?proofError=proofUpload");
    const row = await proofRowFor("inv-737-f");
    expect(row.payment_proof_url).toBeNull();
    expect(row.payment_reference).toBeNull();
  });
});

// ---- 5. the surfaces ---------------------------------------------------------
describe("KID-737: the surfaces", () => {
  async function renderOwnerBilling(): Promise<string> {
    const { default: Page } = await import("@/app/portal/account-billing/page");
    return renderToStaticMarkup(await Page({ searchParams: {} }));
  }

  it("the owner sees no pay link and a form per unpaid invoice while the platform link is unset", async () => {
    await seedInvoice({ id: "inv-737-p", cycleMonth: "2026-10", dueDate: "2026-11-05", status: "pending" });
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const html = await renderOwnerBilling();
    expect(html).not.toContain("Pay with Instapay");
    expect(html).toContain("not set a payment link");
    // Upload form on the pending row.
    expect(html).toContain("Share proof of payment");
  });

  it("with the link set the unpaid row shows Pay with Instapay; the paid row shows neither pay link nor form", async () => {
    await seedInvoice({ id: "inv-737-p2", cycleMonth: "2026-10", dueDate: "2026-11-05", status: "pending" });
    await seedInvoice({ id: "inv-737-pd", cycleMonth: "2026-08", dueDate: "2026-09-05", status: "paid" });
    await queryRun(
      "INSERT INTO platform_setting (key, value, updated_by_account_id, updated_at) VALUES (?, ?, ?, datetime('now'))",
      PLATFORM_INSTAPAY_KEY,
      "https://instapay.eg/pay/kiddyapp",
      superadminId
    );
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const html = await renderOwnerBilling();
    expect(html).toContain("Pay with Instapay");
    expect(html).toContain("https://instapay.eg/pay/kiddyapp");
    // Only the pending row carries the upload form: two hidden invoiceId
    // fields would be the paid row's form sneaking in — there is one.
    expect((html.match(/name="invoiceId"/g) ?? []).length).toBe(1);
  });

  it("the uploaded proof renders as a view link with the recorded reference", async () => {
    await seedInvoice({ id: "inv-737-v", cycleMonth: "2026-10", dueDate: "2026-11-05", status: "pending" });
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const { uploadDaycareInvoiceProofAction } = await import("@/lib/actions");
    const form = formWith({ invoiceId: "inv-737-v", paymentReference: "TX-7372" });
    form.set("file", fileFor(120, "image/png", "receipt.png"));
    await redirectTargetFor(() => uploadDaycareInvoiceProofAction(form));
    const html = await renderOwnerBilling();
    // KID-1177: the stored ref resolves to a signed private URL at render.
    expect(html).toMatch(/storage\.test\/storage\/v1\/object\/sign\/kiddy-private\/payments\//);
    expect(html).not.toContain("kiddy-public/payments/");
    expect(html).toContain("TX-7372");
    expect(html).toContain("Replace proof");
  });

  it("the platform invoice list shows the proof link, upload date and reference for paid rows too", async () => {
    await seedInvoice({ id: "inv-737-pl", cycleMonth: "2026-08", dueDate: "2026-09-05", status: "paid" });
    await queryRun(
      `UPDATE daycare_invoice SET payment_proof_url = ?, payment_proof_uploaded_at = ?, payment_reference = ?
       WHERE id = 'inv-737-pl'`,
      "https://storage.test/kiddy-public/proof-x.pdf",
      new Date().toISOString(),
      "TX-9999"
    );
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { default: Page } = await import("@/app/platform/daycares/[id]/invoices/page");
    const html = await renderToStaticMarkup(await Page({ params: { id: sunshineIid }, searchParams: {} }));
    expect(html).toContain("View proof");
    expect(html).toContain("TX-9999");
  });

  it("the /platform operator page renders the Instapay card with the stored value", async () => {
    await queryRun(
      "INSERT INTO platform_setting (key, value, updated_by_account_id, updated_at) VALUES (?, ?, ?, datetime('now'))",
      PLATFORM_INSTAPAY_KEY,
      "https://instapay.eg/pay/kiddyapp",
      superadminId
    );
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { default: Page } = await import("@/app/platform/page");
    const html = await renderToStaticMarkup(await Page({ searchParams: {} }));
    expect(html).toContain("Subscription payment link (Instapay)");
    expect(html).toContain("https://instapay.eg/pay/kiddyapp");
  });
});

// ---- 6. EN + AR parity -------------------------------------------------------
describe("KID-737: EN + AR parity", () => {
  it("every new key ships in both dictionaries", () => {
    const required = [
      "platform.instapayCardTitle",
      "platform.instapayCardHint",
      "platform.instapayLabel",
      "platform.instapayNotSet",
      "platform.instapayUpdatedAt",
      "platform.instapaySave",
      "platform.instapayClear",
      "platform.instapayInvalid",
      "platform.instapaySaved",
      "platform.invoiceProof",
      "platform.invoiceProofView",
      "platform.invoiceProofNone",
      "platform.invoiceProofUploaded",
      "platform.invoiceProofRef",
      "accountBilling.colPay",
      "accountBilling.colProof",
      "accountBilling.payWithInstapay",
      "accountBilling.payNoLink",
      "accountBilling.proofView",
      "accountBilling.proofUploadedOn",
      "accountBilling.proofUploadLabel",
      "accountBilling.proofUploadBtn",
      "accountBilling.proofReplaceBtn",
      "accountBilling.proofReferencePlaceholder",
      "accountBilling.proofSaved",
      "accountBilling.proofErrorType",
      "accountBilling.proofErrorSize",
      "accountBilling.proofErrorUpload",
      "accountBilling.proofErrorPaid",
    ];
    const enKeys = new Set(keysOf(dictionaries.en));
    const arKeys = new Set(keysOf(dictionaries.ar));
    for (const key of required) {
      expect(enKeys.has(key)).toBe(true);
      expect(arKeys.has(key)).toBe(true);
    }
    // The dictionaries stay key-aligned globally (kid199 pins this too).
    expect([...arKeys].sort()).toEqual([...enKeys].sort());
  });
});
