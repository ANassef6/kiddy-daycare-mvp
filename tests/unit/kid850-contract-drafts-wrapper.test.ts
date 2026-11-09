// KID-850: the contract drafts must carry ONLY the fenced HTML of Adel's
// KID-744 pack documents, never the markdown wrapper around it.
//
// KID-746 embedded the whole pack document (heading + prose + one ```html
// fence) in lib/contract-templates.ts, so every generated draft rendered
// ~600 characters of markdown above the contract. Pinned here:
//   1. The exported templates ARE the fenced HTML only: they start with
//      <!DOCTYPE html> and contain no heading, prose or code fence.
//   2. The extraction is byte-identical to the ```html block inside the pack
//      document source — no clause is trimmed or re-encoded (legal text must
//      stay byte-identical to pack v1.0).
//   3. The extractor fails loudly (throws) when a pack document has no
//      ```html fence or an unclosed one — it can never silently embed a
//      broken draft.
//   4. The full fill for a real daycare produces a draft that starts with
//      <!DOCTYPE html> and there is neither a fence nor a wrapper heading in
//      it (both locales).
//   5. End to end: generateDaycareContractDrafts uploads AR + EN drafts that
//      start with <!DOCTYPE html>, with no wrapper text anywhere in them.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// KID-1177: drafts upload through the service-key client into kiddy-private
// (stand-in: tests/helpers/kid1177-storage.ts); the uploads list the test
// asserts against is the same recorded state.
vi.mock("@/lib/storage", async () => (await import("../helpers/kid1177-storage")).kid1177StorageMock);
const { storage1177 } = await import("../helpers/kid1177-storage");

import { fillContractTemplate, generateDaycareContractDrafts, type ContractDraftData } from "@/lib/contract";
import {
  CONTRACT_TEMPLATE_AR,
  CONTRACT_TEMPLATE_EN,
  CONTRACT_TEMPLATE_VERSION,
  extractContractTemplateHtml,
} from "@/lib/contract-templates";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

// Wrapper prose the pack documents carry AROUND the fence — none of it may
// reach a stored draft.
const WRAPPER_PINS = [
  "```",
  "Machine-Fillable Template",
  "This is the complete, server-renderable",
  "Rules for engineering",
  "قالب قابل للتعبئة آليًا",
  "قواعد الهندسة",
];

const DATA: ContractDraftData = {
  contractRef: "KIDDY-test",
  tradeName: "Sunshine Daycare",
  tradeAddress: "1 Nile St",
  tradeSubdomain: "sunshine",
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
};

let sunshineIid: string;
let ownerId: string;

beforeEach(async () => {
  storage1177.uploads = [];
  storage1177.uploadError = null;
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const owner = await queryGet("SELECT id FROM account WHERE role = 'owner'");
  ownerId = String(owner!.id);
});

describe("KID-850: the templates are the fenced HTML only", () => {
  it("both locale templates start with the contract HTML and carry no wrapper", () => {
    for (const [label, template] of [
      ["EN", CONTRACT_TEMPLATE_EN],
      ["AR", CONTRACT_TEMPLATE_AR],
    ] as const) {
      const t = template.trimStart();
      expect(/^<!DOCTYPE html>/.test(t), `${label} template must start with <!DOCTYPE html>`).toBe(true);
      for (const pin of WRAPPER_PINS) {
        expect(template.includes(pin), `${label} template carries wrapper pin: ${pin}`).toBe(false);
      }
    }
  });

  it("the extraction is byte-identical to the ```html block in the pack document source", () => {
    const source = readFileSync("lib/contract-templates.ts", "utf8");
    // The pack document strings live in this file; recover their fence
    // contents independently of lib's own extractor.
    const fences = [...source.matchAll(/"(?:[^"\\]|\\.)*?```html\\n((?:[^"\\]|\\.)*)\\n```(?:[^"\\]|\\.)*"/g)]
      .map((m) => JSON.parse(`"${m[1]}"`));
    expect(fences.length).toBe(2);
    expect([CONTRACT_TEMPLATE_EN, CONTRACT_TEMPLATE_AR]).toEqual(
      [fences[0], fences[1]]
    );
  });

  it("a pack document without a ```html fence fails loudly", () => {
    expect(() =>
      extractContractTemplateHtml("# Heading\n\nA pack document that lost its template.", "test")
    ).toThrow(/fence/i);
  });

  it("an unclosed ```html fence fails loudly", () => {
    expect(() =>
      extractContractTemplateHtml("# Heading\n\n```html\n<!DOCTYPE html>\n<html></html>\n", "test")
    ).toThrow(/fence/i);
  });

  it("a document with two ```html fences fails loudly (exactly one template accepted)", () => {
    expect(() =>
      extractContractTemplateHtml(
        "# Heading\n\n```html\n<!DOCTYPE html>\n<html></html>\n```\n\n```html\n<html></html>\n```",
        "test"
      )
    ).toThrow(/fence/i);
  });
});

describe("KID-850: the filled draft renders the contract, not the wrapper", () => {
  it("the full AR + EN fill starts with <!DOCTYPE html> and holds no wrapper text", () => {
    for (const locale of ["en", "ar"] as const) {
      const template = locale === "en" ? CONTRACT_TEMPLATE_EN : CONTRACT_TEMPLATE_AR;
      const draft = fillContractTemplate(template, {
        CONTRACT_REF: DATA.contractRef,
        TEMPLATE_VERSION: CONTRACT_TEMPLATE_VERSION,
        DAYCARE_TRADE_NAME: DATA.tradeName,
        VARIABLE: "example", // the template's own instruction comment example
      });
      expect(draft.startsWith("<!DOCTYPE html>"), `${locale} draft must start with <!DOCTYPE html>`).toBe(true);
      for (const pin of WRAPPER_PINS) {
        expect(draft.includes(pin), `${locale} draft carries wrapper pin: ${pin}`).toBe(false);
      }
      // The legal text survived intact: the version stamp renders in the page.
      expect(draft).toContain(locale === "en" ? `Version ${CONTRACT_TEMPLATE_VERSION}` : `الإصدار ${CONTRACT_TEMPLATE_VERSION}`);
      expect(draft).toContain(locale === "en" ? 'lang="en" dir="ltr"' : 'lang="ar" dir="rtl"');
    }
  });
});

describe("KID-850: generateDaycareContractDrafts stores clean drafts", () => {
  it("the uploaded AR + EN draft files start with <!DOCTYPE html> and carry no wrapper", async () => {
    const res = await generateDaycareContractDrafts({ instituteId: sunshineIid, ownerAccountId: ownerId });
    expect(res).toEqual({ ok: true });
    expect(storage1177.uploads.length).toBe(2);
    for (const upload of storage1177.uploads) {
      expect(String(upload.body).startsWith("<!DOCTYPE html>"), ` must start with <!DOCTYPE html>`).toBe(
        true
      );
      for (const pin of WRAPPER_PINS) {
        expect(String(upload.body).includes(pin), ` carries wrapper pin: `).toBe(false);
      }
      expect(String(upload.body)).toContain("Sunshine Daycare");
    }
  });
});
