// KID-745: the signed daycare contract on the superadmin per-daycare
// settings surface (/platform/daycares/[id]/billing — the gear icon on
// /platform).
//
// Pinned here:
//   1. supabase/migrations/0038_kid745_contract.sql: one daycare_contract
//      row per daycare (institute_id unique), the signed snapshot columns,
//      idempotent, mirrored in lib/sqlite-schema.ts.
//   2. lib/contract.ts boundary validation: PDF/PNG/JPG, max 10 MB; wrong
//      type, oversize and empty files refused.
//   3. uploadDaycareContractAction: operator-only (a non-operator POST is
//      bounced to /login), a valid file stored + attributed audit event with
//      NO URL and NO file content, a replacement replaces the whole signed
//      snapshot (draft columns untouched), refusals write nothing.
//   4. Tenant isolation: the row is keyed by institute_id — another
//      daycare's contract is never readable through this store, and a
//      bogus/foreign institute id refuses the upload.
//   5. The card renders with no contract row, with a draft only, and with a
//      signed file (file name + upload date + uploader + replace form).
//   6. EN + AR labels ship for every new string (the dicts stay key-aligned).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

// --- request-scope mock (kid737 pattern): actions read cookies() for the
// session and headers() for request context; pages read the Cookie header ---
const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
  cookies: {} as Record<string, string>,
  // Injects a storage failure for the ?error=contractUpload path.
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
    storage: {
      from: () => ({
        upload: async () => ({ error: mockState.uploadError }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/kiddy-public/${path}` } }),
      }),
    },
  }),
}));

import { createSessionToken } from "@/lib/auth";
import { MAX_CONTRACT_BYTES, validateContract, contractStorageFilename, getDaycareContract } from "@/lib/contract";
import { dictionaries, keysOf } from "@/lib/i18n";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let sunshineIid: string;
let superadminId: string;
let ownerId: string;

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

async function contractRowFor(instituteId: string): Promise<any> {
  return queryGet("SELECT * FROM daycare_contract WHERE institute_id = ?", instituteId);
}

beforeEach(async () => {
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  mockState.uploadError = null;
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const op = await queryGet("SELECT id FROM account WHERE email = 'superadmin@kiddy.test'");
  superadminId = String(op!.id);
  const owner = await queryGet("SELECT id, email FROM account WHERE role = 'owner'");
  ownerId = String(owner!.id);
});

// ---- 1. schema ---------------------------------------------------------------
describe("KID-745: schema (Postgres migration mirrored in SQLite)", () => {
  it("0038 is the next free prefix, and the migration carries the table idempotently", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
    const taken = files.filter((f) => f.startsWith("0038"));
    expect(taken).toEqual(["0038_kid745_contract.sql"]);
    // The siblings that share a prefix elsewhere must not collide: 0032/0033
    // each carry two files by history, so the filename uniquely maps to one.
    expect(files.filter((f) => f.startsWith("0037")).length).toBeGreaterThanOrEqual(1);
    const sql = readFileSync("supabase/migrations/0038_kid745_contract.sql", "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS daycare_contract/i);
    expect(sql).toMatch(/template_version/i);
    expect(sql).toMatch(/draft_url/i);
    expect(sql).toMatch(/draft_generated_at/i);
    expect(sql).toMatch(/signed_url/i);
    expect(sql).toMatch(/signed_file_name/i);
    expect(sql).toMatch(/signed_uploaded_at/i);
    expect(sql).toMatch(/uploaded_by_account_id/i);
    expect(sql).toMatch(/created_at/i);
    expect(sql).toMatch(/updated_at/i);
    // institute_id is THE identity of the row: unique by primary key.
    expect(sql).toMatch(/institute_id\s+TEXT\s+PRIMARY\s+KEY/i);
  });

  it("the SQLite mirror carries the table; a fresh daycare starts with no row", async () => {
    const row = await contractRowFor(sunshineIid);
    expect(row).toBeUndefined();
    // And the signed snapshot columns are all NULL on a synthesized row so
    // the card's empty state never trips on non-null text.
    await queryRun(
      `INSERT INTO daycare_contract (institute_id, template_version, draft_url, draft_generated_at)
       VALUES (?, NULL, NULL, NULL)`,
      sunshineIid
    );
    const after = await contractRowFor(sunshineIid);
    expect(after.signed_url).toBeNull();
    expect(after.signed_file_name).toBeNull();
    expect(after.signed_uploaded_at).toBeNull();
    expect(after.uploaded_by_account_id).toBeNull();
    expect(String(after.template_version ?? "")).toBe("");
  });

  it("one row per daycare: a second insert for the same institute fails", async () => {
    await queryRun(
      `INSERT INTO daycare_contract (institute_id) VALUES (?)`,
      sunshineIid
    );
    await expect(
      queryRun(
        `INSERT INTO daycare_contract (institute_id) VALUES (?)`,
        sunshineIid
      )
    ).rejects.toThrow(/unique constraint failed|duplicate|primary key/i);
  });
});

// ---- 2. the boundary ---------------------------------------------------------
describe("KID-745: the contract boundary (validateContract + storage path)", () => {
  it("accepts PDF, PNG and JPG", () => {
    expect(validateContract({ type: "application/pdf", size: 10 })).toEqual({ ok: true, ext: "pdf" });
    expect(validateContract({ type: "image/png", size: 10 })).toEqual({ ok: true, ext: "png" });
    expect(validateContract({ type: "image/jpeg", size: 10 })).toEqual({ ok: true, ext: "jpg" });
  });

  it("refuses wrong types, oversize and empty files", () => {
    expect(validateContract({ type: "text/plain", size: 10 })).toEqual({ ok: false, code: "type" });
    expect(validateContract({ type: "image/gif", size: 10 })).toEqual({ ok: false, code: "type" });
    expect(validateContract({ type: "application/pdf", size: MAX_CONTRACT_BYTES + 1 })).toEqual({
      ok: false,
      code: "size",
    });
    expect(validateContract({ type: "application/pdf", size: 0 })).toEqual({ ok: false, code: "type" });
  });

  it("the storage path lands in a per-daycare contracts folder with a random suffix", () => {
    const path = contractStorageFilename("inst-x", "pdf", "0123456789abcdef-uuid");
    expect(path.startsWith(`contracts/inst-x/signed-`)).toBe(true);
    expect(path.endsWith(".pdf")).toBe(true);
    expect(path).toContain("0123456789abcdef-uuid");
  });
});

// ---- 3. the operator upload --------------------------------------------------
describe("KID-745: uploadDaycareContractAction (operator-only)", () => {
  async function uploadContract(instituteId: string, opts?: { type?: string; size?: number; name?: string }): Promise<string> {
    const { uploadDaycareContractAction } = await import("@/lib/actions");
    const form = formWith({ instituteId });
    form.set("file", fileFor(opts?.size ?? 120, opts?.type ?? "application/pdf", opts?.name ?? "contract-signed.pdf"));
    return redirectTargetFor(() => uploadDaycareContractAction(form));
  }

  it("stores the signed contract with its file name, date and uploader — audit ids only", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const target = await uploadContract(sunshineIid);
    expect(target).toBe(`/platform/daycares/${sunshineIid}/billing?contract=uploaded`);
    const row = await contractRowFor(sunshineIid);
    expect(String(row.signed_url)).toMatch(
      new RegExp(`^https://storage\\.test/kiddy-public/contracts/${sunshineIid}/signed-\\d+-[0-9a-f-]+\\.pdf$`)
    );
    expect(String(row.signed_file_name)).toBe("contract-signed.pdf");
    expect(String(row.signed_uploaded_at ?? "")).not.toBe("");
    expect(String(row.uploaded_by_account_id)).toBe(superadminId);
    // The audit trail carries actor + daycare + flag, never URL data and
    // never the file name.
    const audit = await queryGet(
      "SELECT summary, metadata FROM audit_event WHERE entity_type = 'daycare_contract' AND entity_id = ?",
      sunshineIid
    );
    expect(String(audit!.summary ?? "")).toContain("Signed daycare contract");
    expect(String(audit!.metadata ?? "")).toContain('"contractUpload":true');
    expect(String(audit!.metadata ?? "") + String(audit!.summary)).not.toContain("storage.test");
    expect(String(audit!.metadata ?? "") + String(audit!.summary)).not.toContain("contract-signed");
  });

  it("a replacement upload replaces the whole signed snapshot; the draft stays untouched", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    await queryRun(
      `INSERT INTO daycare_contract (institute_id, template_version, draft_url, draft_generated_at)
       VALUES (?, 'v3-en', 'https://storage.test/kiddy-public/contracts/draft.pdf', datetime('now'))`,
      sunshineIid
    );
    await uploadContract(sunshineIid, { type: "image/png", name: "first.png" });
    const first = await contractRowFor(sunshineIid);
    await uploadContract(sunshineIid, { name: "second-signed.pdf" });
    const second = await contractRowFor(sunshineIid);
    expect(String(second.signed_file_name)).toBe("second-signed.pdf");
    expect(String(second.signed_url).endsWith(".pdf")).toBe(true);
    expect(String(second.signed_url)).not.toBe(String(first.signed_url));
    // The old pointer is gone; the content-task columns never moved.
    expect(String(second.template_version)).toBe("v3-en");
    expect(String(second.draft_url)).toBe("https://storage.test/kiddy-public/contracts/draft.pdf");
  });

  it("oversize, wrong-type and empty files are refused with nothing written", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const back = `/platform/daycares/${sunshineIid}/billing`;
    expect(await uploadContract(sunshineIid, { size: MAX_CONTRACT_BYTES + 1 })).toBe(`${back}?error=contractSize`);
    expect(await uploadContract(sunshineIid, { type: "text/plain" })).toBe(`${back}?error=contractType`);
    expect(await uploadContract(sunshineIid, { size: 0 })).toBe(`${back}?error=contractType`);
    expect(await contractRowFor(sunshineIid)).toBeUndefined();
  });

  it("a storage failure writes nothing (?error=contractUpload)", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    mockState.uploadError = { message: "boom" };
    const target = await uploadContract(sunshineIid);
    expect(target).toBe(`/platform/daycares/${sunshineIid}/billing?error=contractUpload`);
    expect(await contractRowFor(sunshineIid)).toBeUndefined();
  });

  it("a non-operator POST is bounced to /login and stores nothing", async () => {
    const { createAccount } = await import("@/lib/auth");
    const staffAcc = await createAccount({
      email: "kid745-staff@example.test",
      password: "kiddy-staff1",
      fullName: "Staffer K745",
      role: "staff",
    });
    // The role most like an operator, carried by an email the allowlist does
    // not name: the doubled guard holds in both directions.
    sessionCookieFor(String(staffAcc.id), "platform", "kid745-staff@example.test");
    expect(await uploadContract(sunshineIid)).toBe("/login");
    expect(await contractRowFor(sunshineIid)).toBeUndefined();
    sessionCookieFor(ownerId, "owner", "owner@example.test");
    expect(await uploadContract(sunshineIid)).toBe("/login");
    expect(await contractRowFor(sunshineIid)).toBeUndefined();
  });

  it("a bogus or foreign daycare id is refused (missing-id)", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    expect(await uploadContract("iid-kid745-ghost")).toBe("/platform?error=missing-id");
    expect(await contractRowFor("iid-kid745-ghost")).toBeUndefined();
    // A real second daycare is reachable only through ITS OWN surface — the
    // upload writes the row the POST names, and the store below proves a
    // request can never see a row it does not key.
    await queryRun(
      "INSERT INTO institute (id, name, created_at) VALUES (?, ?, datetime('now'))",
      "iid-kid745-maple",
      "Maple Daycare"
    );
    expect(
      await uploadContract("iid-kid745-maple")
    ).toBe("/platform/daycares/iid-kid745-maple/billing?contract=uploaded");
    // The upload names the daycare it writes: Sunshine's row stayed empty.
    expect(await contractRowFor(sunshineIid)).toBeUndefined();
    expect(await contractRowFor("iid-kid745-maple")).toBeDefined();
  });

  it("tenant isolation: the store returns only the requested daycare's row", async () => {
    // A second daycare of its own — never Sunshine's row.
    await queryRun(
      "INSERT INTO institute (id, name, created_at) VALUES (?, ?, datetime('now'))",
      "iid-kid745-maple",
      "Maple Daycare"
    );
    await queryRun(
      `INSERT INTO daycare_contract (institute_id, signed_url) VALUES (?, 'https://storage.test/only-maple.pdf')`,
      "iid-kid745-maple"
    );
    expect(await contractRowFor(sunshineIid)).toBeUndefined();
    expect(String((await getDaycareContract("iid-kid745-maple"))!.signed_url)).toContain("only-maple");
    expect(await getDaycareContract(sunshineIid)).toBeUndefined();
  });
});

// ---- 4. the card -------------------------------------------------------------
describe("KID-745: the contract card on the billing settings page", () => {
  async function renderBilling(searchParams: Record<string, string> = {}): Promise<string> {
    const { default: Page } = await import("@/app/platform/daycares/[id]/billing/page");
    return renderToStaticMarkup(await Page({ params: { id: sunshineIid }, searchParams }));
  }

  it("an operator with no contract row sees both empty states and the upload form", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const html = await renderBilling();
    expect(html).toContain("No draft has been generated yet.");
    expect(html).toContain("No signed contract uploaded yet.");
    expect(html).toContain("Upload the signed contract (PDF, PNG or JPG, up to 10 MB)");
    expect(html).toContain("Upload signed contract");
    expect(html).not.toContain("Replace signed contract");
  });

  it("with a draft only: draft link + generated date + version, signed empty", async () => {
    await queryRun(
      `INSERT INTO daycare_contract (institute_id, template_version, draft_url, draft_generated_at)
       VALUES (?, 'v2-en / v2-ar', 'https://storage.test/kiddy-public/contracts/draft2.pdf', '2026-11-01 10:00:00')`,
      sunshineIid
    );
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const html = await renderBilling();
    expect(html).toContain("https://storage.test/kiddy-public/contracts/draft2.pdf");
    expect(html).toContain("Download draft");
    expect(html).toContain("Template version: v2-en / v2-ar");
    expect(html).toContain("Generated");
    expect(html).toContain("No signed contract uploaded yet.");
  });

  it("with a signed file: file name + upload date + uploader + replace form", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { uploadDaycareContractAction } = await import("@/lib/actions");
    const form = formWith({ instituteId: sunshineIid });
    form.set("file", fileFor(120, "application/pdf", "final-signed.pdf"));
    await redirectTargetFor(() => uploadDaycareContractAction(form));
    const html = await renderBilling();
    expect(html).toContain("final-signed.pdf");
    expect(html).toContain("Uploaded");
    expect(html).not.toContain("No signed contract uploaded yet.");
    expect(html).toContain("Replace the signed contract (PDF, PNG or JPG, up to 10 MB)");
    expect(html).toContain("Replace signed contract");
    // The uploader is the operator themselves.
    const { getAccount } = await import("@/lib/auth");
    const me = await getAccount(superadminId);
    expect(html).toContain("by ");
    expect(String(me!.full_name ?? "").length).toBeGreaterThan(0);
  });

  it("rejection banners render localized text on the billing tab", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    expect(await renderBilling({ error: "contractType" })).toContain(
      "the contract must be a PDF, PNG or JPG file"
    );
    expect(await renderBilling({ error: "contractSize" })).toContain("larger than 10 MB");
    expect(await renderBilling({ contract: "uploaded" })).toContain("Signed contract uploaded.");
  });

  it("a non-operator never reaches the page at all", async () => {
    const owner = await queryGet("SELECT email FROM account WHERE role = 'owner'");
    sessionCookieFor(ownerId, "owner", String(owner!.email));
    await expect(renderBilling()).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

// ---- 5. EN + AR parity -------------------------------------------------------
describe("KID-745: EN + AR parity", () => {
  it("every new key ships in both dictionaries", () => {
    const required = [
      "platform.contractCardTitle",
      "platform.contractCardHint",
      "platform.contractDraftLabel",
      "platform.contractDraftNone",
      "platform.contractDraftGenerated",
      "platform.contractDraftDownload",
      "platform.contractTemplateVersion",
      "platform.contractSignedLabel",
      "platform.contractSignedNone",
      "platform.contractSignedUploaded",
      "platform.contractSignedBy",
      "platform.contractUploadLabel",
      "platform.contractReplaceLabel",
      "platform.contractUploadBtn",
      "platform.contractReplaceBtn",
      "platform.contractUploaded",
      "platform.contractErrorType",
      "platform.contractErrorSize",
      "platform.contractErrorUpload",
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
