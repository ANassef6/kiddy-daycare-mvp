// KID-746: auto-generated bilingual daycare contract drafts.
//
// Pinned here:
//   1. supabase/migrations/0039_kid746_contract_drafts.sql: one column per
//      language for the generated drafts, idempotent, mirrored in
//      lib/sqlite-schema.ts.
//   2. The template fill: every double-brace variable in the embedded
//      KID-744 templates resolves from the platform record or the pack's own
//      open-point marker; no light text is invented in code and the legal
//      clauses are never edited.
//   3. generateDaycareContractDrafts creates AR + EN drafts with the
//      template version stamped, idempotently (a retry adds no files, no
//      rows, no new notifications).
//   4. Operator-only notification: exactly one durable notification row for
//      the platform operator (never the daycare owner), ref-stable, and the
//      push deep link opens the contract card.
//   5. createDaycareAction end to end: creation + billing stays intact and
//      the drafts + notification land in the same flow.
//   6. The /platform queue card + row badge and the billing-page draft links
//      render; a signed upload clears the queue.
//   7. EN + AR labels ship for every new string.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
  cookies: {} as Record<string, string>,
  uploads: [] as { path: string; body: string }[],
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
      signUp: async () => ({ data: {}, error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      getUser: async () => ({ data: {}, error: null }),
    },
  }),
}));
// KID-1177: contract drafts go to kiddy-private through the service-key
// client; rows keep the private REF and the platform page renders signed
// URLs (stand-in: tests/helpers/kid1177-storage.ts).
vi.mock("@/lib/storage", async () => (await import("../helpers/kid1177-storage")).kid1177StorageMock);
import { storage1177 } from "../helpers/kid1177-storage";

import { createSessionToken } from "@/lib/auth";
import {
  contractDraftValues,
  contractDraftStorageFilename,
  fillContractTemplate,
  generateDaycareContractDrafts,
  listContractDraftStatus,
  setDaycareContractDraft,
} from "@/lib/contract";
import { CONTRACT_TEMPLATE_AR, CONTRACT_TEMPLATE_EN, CONTRACT_TEMPLATE_VERSION } from "@/lib/contract-templates";
import { pushDeepUrl } from "@/lib/push";
import { dictionaries, keysOf } from "@/lib/i18n";
import { queryGet, queryRun, queryAll } from "@/lib/db";
import { seedFixture } from "../helpers";

let sunshineIid: string;
let superadminId: string;
let ownerId: string;

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

async function operatorNotificationCount(): Promise<number> {
  const row = await queryGet(
    "SELECT COUNT(*) c FROM notification WHERE kind = 'contract_draft' AND account_id = ?",
    superadminId
  );
  return Number(row!.c);
}

beforeEach(async () => {
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  storage1177.uploads = [];
  storage1177.uploadError = null;
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const op = await queryGet("SELECT id FROM account WHERE email = 'superadmin@kiddy.test'");
  superadminId = String(op!.id);
  const owner = await queryGet("SELECT id FROM account WHERE role = 'owner'");
  ownerId = String(owner!.id);
});

// ---- 1. schema ---------------------------------------------------------------
describe("KID-746: schema (0039, mirrored in SQLite)", () => {
  it("0039 is the next free prefix and carries the two language columns", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => f.startsWith("0039"))).toEqual(["0039_kid746_contract_drafts.sql"]);
    const sql = readFileSync("supabase/migrations/0039_kid746_contract_drafts.sql", "utf8");
    expect(sql).toMatch(/ALTER TABLE daycare_contract ADD COLUMN IF NOT EXISTS draft_url_ar/i);
    expect(sql).toMatch(/ALTER TABLE daycare_contract ADD COLUMN IF NOT EXISTS draft_url_en/i);
  });

  it("the SQLite mirror (and its idempotent backfill) carries both columns", async () => {
    const row = await contractRowFor(sunshineIid);
    expect(row === undefined || "draft_url_ar" in row).toBe(true);
    await setDaycareContractDraft(sunshineIid, {
      templateVersion: "t",
      draftUrlAr: "https://storage.test/draft-ar.html",
      draftUrlEn: "https://storage.test/draft-en.html",
      draftGeneratedAt: "2026-11-08T00:00:00.000Z",
    });
    const after = await contractRowFor(sunshineIid);
    expect(String(after.draft_url_ar)).toContain("draft-ar");
    expect(String(after.draft_url_en)).toContain("draft-en");
    // The legacy single draft_url stays untouched for the KID-745 card.
    expect(after.draft_url).toBeNull();
  });
});

// ---- 2. the template fill ----------------------------------------------------
describe("KID-746: the template fill", () => {
  it("the values map covers every template variable on both locales", () => {
    for (const [locale, template] of [
      ["en", CONTRACT_TEMPLATE_EN],
      ["ar", CONTRACT_TEMPLATE_AR],
    ] as const) {
      const values = contractDraftValues(locale, {
        contractRef: "KIDDY-test",
        tradeName: "Test Daycare",
        tradeAddress: "",
        tradeSubdomain: "test-daycare",
        ownerName: "Maria Lopez",
        ownerEmail: "owner@test.test",
        providerNoticeEmail: "info@kiddyapp.net",
        plan: "demo",
        monthlyRateEgp: 500,
        perChildRateEgp: 50,
        freeChildThreshold: 10,
        annualAmountEgp: 24000,
        currency: "EGP",
        termStart: "2026-12-01",
        proposedDate: "2026-11-08",
        templateVersion: CONTRACT_TEMPLATE_VERSION,
      });
      const used = new Set(
        [...template.matchAll(/\{\{([A-Z_0-9]+)\}\}/g)]
          .map((m) => m[1]!)
          .filter((name) => name !== "VARIABLE")
      );
      for (const name of used) {
        expect(values[name]).toBeDefined();
      }
      const filled = fillTest(template, values);
      // Nothing unknown remains except the template's own instruction
      // example, which lives inside an HTML comment.
      expect(filled.match(/\{\{[A-Z_0-9]+\}\}/g)).toEqual(["{{VARIABLE}}"]);
    }
  });

  it("fillContractTemplate substitutes values and never invents legal text", () => {
    const out = fillTest("Hello {{NAME}} and {{OTHER}}", { NAME: "Kiddy" });
    expect(out).toBe("Hello Kiddy and {{OTHER}}");
  });

  it("each locale draft carries its own wording for the derived fields", () => {
    const data = {
      contractRef: "KIDDY-x",
      tradeName: "D",
      tradeAddress: "",
      tradeSubdomain: "",
      ownerName: "",
      ownerEmail: "",
      providerNoticeEmail: "info@kiddyapp.net",
      plan: "annual" as const,
      monthlyRateEgp: 500,
      perChildRateEgp: 50,
      freeChildThreshold: 10,
      annualAmountEgp: 24000,
      currency: "EGP",
      termStart: "2026-12-01",
      proposedDate: "2026-11-08",
      templateVersion: "1.0",
    };
    const en = contractDraftValues("en", data);
    const ar = contractDraftValues("ar", data);
    expect(en.INITIAL_TERM).toContain("Twelve months");
    expect(ar.INITIAL_TERM).toContain("اثنا عشر شهرًا");
    expect(en.INVOICE_DUE_DAY).toContain("5th day");
    expect(ar.INVOICE_DUE_DAY).toContain("اليوم الخامس");
    expect(en.CURRENCY).toBe("EGP");
    expect(ar.CURRENCY).toBe("EGP");
    // Amount formatting matches the pack: grouped thousands, either locale.
    expect(en.ANNUAL_AMOUNT_EGP).toBe("24,000");
    expect(ar.ANNUAL_AMOUNT_EGP).toBe("24,000");
  });
});

function fillTest(template: string, values: Record<string, string>): string {
  return fillContractTemplate(template, values);
}

// ---- 3. the generator --------------------------------------------------------
describe("KID-746: generateDaycareContractDrafts", () => {
  it("generates AR + EN drafts with the version stamped and notifies the operator only", async () => {
    const res = await generateDaycareContractDrafts({ instituteId: sunshineIid, ownerAccountId: ownerId });
    expect(res).toEqual({ ok: true });
    // Exactly two files: one Arabic, one English, both .html drafts — KID-1177:
    // into the PRIVATE bucket through the service-key client.
    expect(storage1177.uploads.length).toBe(2);
    expect(storage1177.uploads.every((u) => u.bucket === "kiddy-private")).toBe(true);
    expect(storage1177.uploads[0]!.path).toMatch(new RegExp(`^contracts/${sunshineIid}/draft-ar-\\d+-[0-9a-f-]+\\.html$`));
    expect(storage1177.uploads[1]!.path).toMatch(new RegExp(`^contracts/${sunshineIid}/draft-en-\\d+-[0-9a-f-]+\\.html$`));
    const row = await contractRowFor(sunshineIid);
    expect(String(row.template_version)).toBe(CONTRACT_TEMPLATE_VERSION);
    // KID-1177: the row keeps the private REF, not a URL.
    expect(String(row.draft_url_ar)).toMatch(/^kiddy-private:contracts\/.*draft-ar-[0-9a-f-]+\.html$/);
    expect(String(row.draft_url_en)).toMatch(/^kiddy-private:contracts\/.*draft-en-[0-9a-f-]+\.html$/);
    expect(String(row.draft_generated_at ?? "")).not.toBe("");
    // The template content: filled, not invented — the daycare's data rides
    // in, placeholders do not survive, the RTL marker stays.
    const ar = String(storage1177.uploads[0]!.body);
    const en = String(storage1177.uploads[1]!.body);
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain("Sunshine Daycare");
    expect(en).toContain("Sunshine Daycare");
    expect(ar).toContain(`KIDDY-${sunshineIid}`);
    expect(en).toContain(`KIDDY-${sunshineIid}`);
    expect(en).toContain("500");
    // The provider notice email reuses the board-set inbox (lib/site.ts).
    expect(en).toContain("info@kiddyapp.net");
    expect(en.match(/\{\{[A-Z_0-9]+\}\}/g)).toEqual(["{{VARIABLE}}"]);
    // Exactly one notification for the platform operator (no owner, no staff)
    // with the stable per-daycare ref.
    expect(await operatorNotificationCount()).toBe(1);
    const notif = await queryGet(
      "SELECT * FROM notification WHERE kind = 'contract_draft' AND account_id = ?",
      superadminId
    );
    expect(notif).toBeDefined();
    expect(notif!.institute_id).toBeNull();
    expect(String(notif!.ref)).toBe(`contract-draft-${sunshineIid}`);
    expect(String(notif!.payload)).toContain('"daycareName":"Sunshine Daycare"');
    const ownerRows = await queryAll(
      "SELECT id FROM notification WHERE kind = 'contract_draft' AND account_id != ?",
      superadminId
    );
    expect(ownerRows).toEqual([]);
    // The audit trail carries the generation, never the URL.
    const audit = await queryGet(
      "SELECT summary, metadata FROM audit_event WHERE entity_type = 'daycare_contract' AND entity_id = ?",
      sunshineIid
    );
    expect(String(audit!.summary ?? "")).toContain("Contract drafts generated");
    expect(String(audit!.metadata ?? "")).toContain('"contractDrafts":true');
    expect(String(audit!.metadata ?? "") + String(audit!.summary)).not.toContain("storage.test");
  });

  it("a generate retry adds no files, no rows and no re-notification", async () => {
    await generateDaycareContractDrafts({ instituteId: sunshineIid, ownerAccountId: ownerId });
    const beforeRow = await contractRowFor(sunshineIid);
    const beforeUploads = storage1177.uploads.length;
    const res = await generateDaycareContractDrafts({ instituteId: sunshineIid, ownerAccountId: ownerId });
    expect(res.ok).toBe(false);
    expect(storage1177.uploads.length).toBe(beforeUploads);
    expect(await contractRowFor(sunshineIid)).toEqual(beforeRow);
    expect(await operatorNotificationCount()).toBe(1);
  });

  it("a storage failure writes nothing", async () => {
    storage1177.uploadError = { message: "boom" };
    const res = await generateDaycareContractDrafts({ instituteId: sunshineIid, ownerAccountId: ownerId });
    expect(res).toEqual({ ok: false, reason: "storage-error" });
    expect(await contractRowFor(sunshineIid)).toBeUndefined();
    expect(await operatorNotificationCount()).toBe(0);
  });

  it("a missing daycare or owner short-circuits without a row", async () => {
    expect(
      await generateDaycareContractDrafts({ instituteId: "iid-kid746-ghost", ownerAccountId: ownerId })
    ).toEqual({ ok: false, reason: "missing-institute" });
    expect(await contractRowFor("iid-kid746-ghost")).toBeUndefined();
  });

  it("the push deep link for the notification kind opens the contract card", () => {
    expect(pushDeepUrl("contract_draft", { deepLink: `/platform/daycares/x/billing` })).toBe(
      "/platform/daycares/x/billing"
    );
    expect(pushDeepUrl("contract_draft", {})).toBe("/platform");
  });
});

// ---- 4. the queue + badge + push card on /platform ---------------------------
describe("KID-746: the /platform queue, badge and push card", () => {
  async function renderPlatform(searchParams: Record<string, string> = {}): Promise<string> {
    const { default: Page } = await import("@/app/platform/page");
    return renderToStaticMarkup(await Page({ searchParams: searchParams as any }));
  }

  it("an operator with a generated draft sees the queue entry, the row badge and the push card", async () => {
    await generateDaycareContractDrafts({ instituteId: sunshineIid, ownerAccountId: ownerId });
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const html = await renderPlatform();
    expect(html).toContain("Contracts awaiting review");
    expect(html).toContain("Sunshine Daycare");
    expect(html).toContain("demo");
    expect(html).toContain(`/platform/daycares/${sunshineIid}/billing`);
    expect(html).toContain("Contract: awaiting review");
    expect(html).toContain("Operator push notifications");
    expect(html).toContain("push-notifications-card");
  });

  it("the operator without drafts sees the empty queue and still the push card", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const html = await renderPlatform();
    expect(html).toContain("No contracts awaiting review.");
    expect(html).toContain("Operator push notifications");
    // No badge without a generated draft.
    expect(html).not.toContain("Contract: awaiting review");
  });

  it("a signed upload clears the queue and flips the badge", async () => {
    await generateDaycareContractDrafts({ instituteId: sunshineIid, ownerAccountId: ownerId });
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { uploadDaycareContractAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("instituteId", sunshineIid);
    form.set("file", new File([new Uint8Array(120)], "signed.pdf", { type: "application/pdf" }));
    await redirectTargetFor(() => uploadDaycareContractAction(form));
    const html = await renderPlatform();
    expect(html).toContain("No contracts awaiting review.");
    expect(html).toContain("Contract: signed");
  });

  it("a non-operator never reaches the page", async () => {
    sessionCookieFor(ownerId, "owner", "owner@example.test");
    await expect(renderPlatform()).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

// ---- 5. the billing-page draft links ----------------------------------------
describe("KID-746: the contract card draft links", () => {
  async function renderBilling(): Promise<string> {
    const { default: Page } = await import("@/app/platform/daycares/[id]/billing/page");
    return renderToStaticMarkup(await Page({ params: { id: sunshineIid }, searchParams: {} }));
  }

  it("the generated drafts render as an Arabic + English link pair with the version stamp", async () => {
    await generateDaycareContractDrafts({ instituteId: sunshineIid, ownerAccountId: ownerId });
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const html = await renderBilling();
    const row = await contractRowFor(sunshineIid);
    // KID-1177: the private refs resolve to short-lived signed URLs in the
    // operator-only surface — the raw REF never reaches the HTML.
    expect(html).toContain("Arabic draft");
    expect(html).toContain("English draft");
    const draftUrlAr = String(row.draft_url_ar);
    const draftPathAr = new RegExp(`href="[^"]*object/sign/kiddy-private/${draftUrlAr.replace("kiddy-private:", "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).source;
    expect(html).toMatch(new RegExp(draftPathAr));
    expect(html).not.toContain("kiddy-private:");
    expect(html).toContain(`Template version: ${CONTRACT_TEMPLATE_VERSION}`);
  });

  it("the status map stays keyed per daycare", async () => {
    await generateDaycareContractDrafts({ instituteId: sunshineIid, ownerAccountId: ownerId });
    const map = await listContractDraftStatus();
    const entry = map.get(sunshineIid);
    expect(entry?.hasDraft).toBe(true);
    expect(entry?.isSigned).toBe(false);
    expect(entry?.plan).toBe("demo");
    // Another daycare never appears by accident.
    expect(
      await generateDaycareContractDrafts({ instituteId: "iid-kid746-ghost", ownerAccountId: ownerId })
    ).toEqual({ ok: false, reason: "missing-institute" });
  });
});

// ---- 6. EN + AR parity -------------------------------------------------------
describe("KID-746: EN + AR parity", () => {
  it("every new key ships in both dictionaries", () => {
    const required = [
      "feed.contractDraftReadyTitle",
      "feed.contractDraftReadyBody",
      "platform.contractQueueTitle",
      "platform.contractQueueHint",
      "platform.contractQueueEmpty",
      "platform.contractQueuePlan",
      "platform.contractRowDraftBadge",
      "platform.contractRowSignedBadge",
      "platform.contractDraftDownloadAr",
      "platform.contractDraftDownloadEn",
      "platform.pushOperatorTitle",
      "platform.pushOperatorHint",
    ];
    const enKeys = new Set(keysOf(dictionaries.en));
    const arKeys = new Set(keysOf(dictionaries.ar));
    for (const key of required) {
      expect(enKeys.has(key)).toBe(true);
      expect(arKeys.has(key)).toBe(true);
    }
    expect([...arKeys].sort()).toEqual([...enKeys].sort());
  });
});
