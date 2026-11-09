// KID-745: the signed daycare contract.
//
// Two layers, mirroring lib/payment-proof.ts:
//   1. Pure boundary helpers — validation and the storage path — that the
//      upload action (lib/actions.ts) runs BEFORE any storage or database
//      write, so an unsupported file can never create a partial record.
//   2. The store read/writers for the daycare_contract row (migration 0038 /
//      mirror in lib/sqlite-schema.ts). One row per daycare (institute_id is
//      the primary key); the signed snapshot (signed_url + signed_file_name +
//      signed_uploaded_at + uploaded_by_account_id) always moves together, so
//      a replacement upload can never leave a stale pointer behind.

import { ensureSchema, isPostgresMode, queryAll, queryGet, queryRun } from "@/lib/db";
import type { Row } from "@/lib/db";

export const MAX_CONTRACT_BYTES = 10 * 1024 * 1024;

export const CONTRACT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

export type ContractValidation =
  | { ok: true; ext: string }
  | { ok: false; code: "type" | "size" };

/** A signed contract is a PDF, PNG or JPG capped at 10 MB. Empty and
 *  wrong-type files both read as a type failure — the caller turns the code
 *  into a localized banner before anything is stored. */
export function validateContract(file: { type?: unknown; size?: unknown }): ContractValidation {
  const size = Number(file.size ?? 0);
  if (size > MAX_CONTRACT_BYTES) return { ok: false, code: "size" };
  const type = String(file.type ?? "").toLowerCase();
  const ext = CONTRACT_TYPES[type];
  if (!ext || !(size > 0)) return { ok: false, code: "type" };
  return { ok: true, ext };
}

/** Object path inside the PUBLIC bucket — legacy note kept in one line: the
 *  KID-745 shape was unguessable-public. KID-1177 moved this call site to the
 *  private bucket (kiddy-private via lib/storage.ts) with the row keeping the
 *  private REF; the path/filename pattern is unchanged. */
export function contractStorageFilename(
  instituteId: string,
  ext: string,
  randomSuffix: string
): string {
  return `contracts/${instituteId}/signed-${Date.now()}-${randomSuffix}.${ext}`;
}

export type DaycareContractRow = Row & {
  institute_id: string;
  template_version: string | null;
  draft_url: string | null;
  draft_url_ar: string | null;
  draft_url_en: string | null;
  draft_generated_at: string | null;
  signed_url: string | null;
  signed_file_name: string | null;
  signed_uploaded_at: string | null;
  uploaded_by_account_id: string | null;
};

/** The one contract row for a daycare — never another tenant's: the row is
 *  keyed by institute_id and every caller passes its own verified id. */
export async function getDaycareContract(
  instituteId: string
): Promise<DaycareContractRow | undefined> {
  return (await queryGet("SELECT * FROM daycare_contract WHERE institute_id = ?", instituteId)) as
    | DaycareContractRow
    | undefined;
}

/** Uploader display name for the contract card — null when the account was
 *  deleted (uploaded_by_account_id is SET NULL; the card then shows no
 *  uploader line). */
export async function getDaycareContractUploaderName(
  accountId: string
): Promise<string | null> {
  const row = await queryGet("SELECT full_name FROM account WHERE id = ?", accountId);
  if (!row) return null;
  return String(row.full_name ?? "") || null;
}

/** Upsert the CURRENT signed-contract snapshot. Replace-or-create in one
 *  statement (both engines accept ON CONFLICT; lib/platform-settings.ts uses
 *  the same shape): the four signed columns move together, updated_at is
 *  recomputed on every write so a replacement always moves the timestamp,
 *  and the template/draft columns are never touched here — the content task
 *  owns the draft. */
export async function setDaycareContractSigned(
  instituteId: string,
  patch: {
    signedUrl: string;
    signedFileName: string;
    signedUploadedAt: string;
    uploadedByAccountId: string;
  }
): Promise<void> {
  // Reaching into daycare_contract before the schema exists must never throw
  // the action away — migrate-on-boot covers the app; a fresh test database
  // and pg warm instances both already have it (same split as
  // setPlatformSetting).
  await ensureSchema();
  const nowExpr = isPostgresMode() ? "now()" : "datetime('now')";
  await queryRun(
    `INSERT INTO daycare_contract
       (institute_id, template_version, draft_url, draft_generated_at, signed_url,
        signed_file_name, signed_uploaded_at, uploaded_by_account_id, created_at, updated_at)
     VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, ${nowExpr}, ${nowExpr})
     ON CONFLICT (institute_id) DO UPDATE SET
       signed_url = excluded.signed_url,
       signed_file_name = excluded.signed_file_name,
       signed_uploaded_at = excluded.signed_uploaded_at,
       uploaded_by_account_id = excluded.uploaded_by_account_id,
       updated_at = ${nowExpr}`,
     instituteId,
     patch.signedUrl,
     patch.signedFileName,
     patch.signedUploadedAt,
     patch.uploadedByAccountId
   );
}

// ---------------------------------------------------------------------------
// KID-746: auto-generated bilingual contract drafts.
//
// On createDaycareAction success the platform fills the approved template
// (contract-templates.ts, pack v1.0 from KID-744 — Arabic prevails) with the
// daycare's own record and stores ONE Arabic + ONE English draft through the
// same kiddy-public contracts/ storage path the signed upload uses. The CEO
// then sends the drafts to the daycare and uploads the signed copy — the
// platform never sends anything to the daycare owner itself.
//
// Variables the platform record does NOT carry (entity details, signatory
// authority, VAT, liability cap, demo end date, sub-processors) are filled
// with the pack's own open-point marker, so a generated draft is clearly a
// draft for CEO review — never a signature-ready document.
// ---------------------------------------------------------------------------

/** Substitute every provided variable into a machine-fillable template.
 *  Unknown variables are left as-is (the template's own instruction comment
 *  legitimately keeps its {{VARIABLE}} example). Pure. */
export function fillContractTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [name, value] of Object.entries(values)) {
    out = out.split(`{{${name}}}`).join(value);
  }
  return out;
}

/** Object path inside the PRIVATE bucket (KID-1177): one file per language,
 *  per daycare folder, timestamp + random suffix. Unchanged shape, but the
 *  object is no longer publicly addressable — plane of control is the
 *  signed-URL mint, not the unguessable name. */
export function contractDraftStorageFilename(
  instituteId: string,
  locale: "ar" | "en",
  randomSuffix: string
): string {
  return `contracts/${instituteId}/draft-${locale}-${Date.now()}-${randomSuffix}.html`;
}

/** The commercial data a contract draft needs, read from the platform's own
 *  records. `currency` is always EGP — the platform bills in EGP by design
 *  (KID-489: the EGP default; the daycare_billing columns are EGP-named). */
export type ContractDraftData = {
  contractRef: string;
  tradeName: string;
  tradeAddress: string;
  tradeSubdomain: string;
  ownerName: string;
  ownerEmail: string;
  providerNoticeEmail: string;
  plan: "demo" | "monthly" | "annual";
  monthlyRateEgp: number;
  perChildRateEgp: number;
  freeChildThreshold: number;
  annualAmountEgp: number;
  currency: string;
  termStart: string;
  proposedDate: string;
  templateVersion: string;
};

/** Plain markers the KID-744 pack itself uses for CEO-only open points. */
const TBC_BY_LOCALE = { en: "[TO BE CONFIRMED BY CEO]", ar: "[مطلوب للتأكيد من الرئيس التنفيذي]" };

const egp = (n: number): string => Number(n ?? 0).toLocaleString("en-US");

/** Term phrases per plan, exactly as the pack's Sunshine issued contract
 *  worded them (sunshine-contract-en / -ar). Values live per-language because
 *  the Arabic version prevails and both copies are read by humans. */
function termValues(plan: "demo" | "monthly" | "annual", locale: "ar" | "en") {
  if (plan === "demo") {
    return locale === "en"
      ? {
          INITIAL_TERM: "Demo period, ending on the date confirmed by the CEO",
          RENEWAL_TERM: "None during demo; monthly on conversion unless agreed otherwise",
          DEMO_PERIOD: "[TO BE CONFIRMED BY CEO]",
          DEMO_CONVERSION_PLAN: "[TO BE CONFIRMED BY CEO]",
        }
      : {
          INITIAL_TERM: "فترة العرض التجريبي، وتنتهي في التاريخ المؤكد من الرئيس التنفيذي",
          RENEWAL_TERM: "لا تجديد خلال العرض التجريبي؛ وتتجدد شهريًا عند التحويل ما لم يتفق على خلاف ذلك",
          DEMO_PERIOD: "[مطلوب للتأكيد من الرئيس التنفيذي]",
          DEMO_CONVERSION_PLAN: "[مطلوب للتأكيد من الرئيس التنفيذي]",
        };
  }
  if (plan === "monthly") {
    return locale === "en"
      ? { INITIAL_TERM: "One month", RENEWAL_TERM: "Successive monthly terms", DEMO_PERIOD: "N/A", DEMO_CONVERSION_PLAN: "N/A" }
      : { INITIAL_TERM: "شهر واحد", RENEWAL_TERM: "فترات شهرية متتالية", DEMO_PERIOD: "لا ينطبق", DEMO_CONVERSION_PLAN: "لا ينطبق" };
  }
  return locale === "en"
    ? { INITIAL_TERM: "Twelve months", RENEWAL_TERM: "Successive twelve-month terms", DEMO_PERIOD: "N/A", DEMO_CONVERSION_PLAN: "N/A" }
    : { INITIAL_TERM: "اثنا عشر شهرًا", RENEWAL_TERM: "فترات متتالية كل اثني عشر شهرًا", DEMO_PERIOD: "لا ينطبق", DEMO_CONVERSION_PLAN: "لا ينطبق" };
}

/** Every template variable mapped to its platform value (or the pack's own
 *  open-point marker when the value is CEO-only). The test suite asserts the
 *  map covers the template's full variable list on both locales. */
export function contractDraftValues(
  locale: "ar" | "en",
  data: ContractDraftData
): Record<string, string> {
  const tbc = TBC_BY_LOCALE[locale];
  const billingEmail = `${data.ownerEmail} (account on record — ${tbc})`;
  const signatory = `${tbc} (platform account: ${data.ownerName})`;
  const effective = `${tbc} (${locale === "en" ? "proposed" : "مقترح"}: ${data.proposedDate})`;
  const common = {
    CONTRACT_REF: data.contractRef,
    TEMPLATE_VERSION: data.templateVersion,
    PROVIDER_LEGAL_NAME: `KiddyApp ${tbc}`,
    PROVIDER_CRN: tbc,
    PROVIDER_TAX_ID: tbc,
    PROVIDER_ADDRESS: tbc,
    // KID-238: the provider notice address has exactly ONE source (lib/site.ts,
    // board-set default, env-overridable) — this draft reuses it.
    PROVIDER_NOTICE_EMAIL: data.providerNoticeEmail,
    PROVIDER_SIGNATORY: tbc,
    PROVIDER_SIGNATORY_TITLE: tbc,
    DAYCARE_LEGAL_NAME: data.tradeName,
    DAYCARE_TRADE_NAME: data.tradeName,
    DAYCARE_CRN: tbc,
    DAYCARE_TAX_ID: tbc,
    DAYCARE_ADDRESS: data.tradeAddress || tbc,
    DAYCARE_BILLING_EMAIL: billingEmail,
    DAYCARE_NOTICE_EMAIL: `${data.ownerEmail} (account on record — ${tbc})`,
    DAYCARE_SIGNATORY: signatory,
    DAYCARE_SIGNATORY_TITLE: tbc,
    DAYCARE_DP_CONTACT: tbc,
    DAYCARE_SUBDOMAIN: data.tradeSubdomain || "-",
    PLAN: data.plan,
    MONTHLY_RATE_EGP: egp(data.monthlyRateEgp),
    PER_CHILD_RATE_EGP: egp(data.perChildRateEgp),
    FREE_CHILD_THRESHOLD: String(data.freeChildThreshold),
    ANNUAL_AMOUNT_EGP: egp(data.annualAmountEgp),
    CURRENCY: data.currency,
    TERM_START: data.termStart || "-",
    EFFECTIVE_DATE: effective,
    NOTICE_PERIOD_DAYS: "30",
    LIABILITY_CAP_EGP: tbc,
    LIABILITY_CAP_WORDS: tbc,
    VAT_TREATMENT: tbc,
    PAYMENT_METHOD: tbc,
    INVOICE_DUE_DAY:
      locale === "en"
        ? "5th day of the month following the invoice date"
        : "اليوم الخامس من الشهر التالي لتاريخ الفاتورة",
    LATE_INTEREST: tbc,
    COURTS: locale === "en" ? "Cairo, Egypt" : "القاهرة، جمهورية مصر العربية",
    PREVAILING_LANGUAGE: locale === "en" ? "Arabic" : "العربية",
    ADDITIONAL_SERVICES:
      locale === "en" ? "None stated" : "لا توجد خدمات إضافية مذكورة",
    SUBPROCESSOR_1_NAME: tbc,
    SUBPROCESSOR_1_LOCATION: tbc,
    SUBPROCESSOR_1_SAFEGUARDS: tbc,
    SUBPROCESSOR_2_NAME: tbc,
    SUBPROCESSOR_2_LOCATION: tbc,
    SUBPROCESSOR_2_SAFEGUARDS: tbc,
    SUBPROCESSOR_3_NAME: tbc,
    SUBPROCESSOR_3_LOCATION: tbc,
    SUBPROCESSOR_3_SAFEGUARDS: tbc,
  };
  return { ...common, ...termValues(data.plan, locale) };
}

/** Upsert the CURRENT bilingual draft snapshot. Same replace-or-create shape
 *  as setDaycareContractSigned: the three draft columns move together and
 *  updated_at moves, while the signed snapshot is never touched here — the
 *  operator's signed upload owns those columns. The legacy single draft_url
 *  is deliberately left alone: generated drafts surface through
 *  draft_url_ar / draft_url_en. */
export async function setDaycareContractDraft(
  instituteId: string,
  patch: {
    templateVersion: string;
    draftUrlAr: string;
    draftUrlEn: string;
    draftGeneratedAt: string;
  }
): Promise<void> {
  await ensureSchema();
  const nowExpr = isPostgresMode() ? "now()" : "datetime('now')";
  await queryRun(
    `INSERT INTO daycare_contract
       (institute_id, template_version, draft_url, draft_url_ar, draft_url_en, draft_generated_at)
     VALUES (?, ?, NULL, ?, ?, ?)
     ON CONFLICT (institute_id) DO UPDATE SET
       template_version = excluded.template_version,
       draft_url_ar = excluded.draft_url_ar,
       draft_url_en = excluded.draft_url_en,
       draft_generated_at = excluded.draft_generated_at,
       updated_at = ${nowExpr}`,
    instituteId,
    patch.templateVersion,
    patch.draftUrlAr,
    patch.draftUrlEn,
    patch.draftGeneratedAt
  );
}

/** One query for the operator surface: every daycare with a generated draft
 *  (or a signed copy), its plan and timestamp — the Contracts awaiting review
 *  queue and the per-row contract status badge read this map. */
export async function listContractDraftStatus(): Promise<
  Map<
    string,
    {
      hasDraft: boolean;
      isSigned: boolean;
      plan: string;
      generatedAt: string | null;
    }
  >
> {
  await ensureSchema();
  const rows = await queryAll(
    `SELECT c.institute_id, c.draft_url_ar, c.draft_url_en, c.draft_url,
            c.draft_generated_at, c.signed_url, COALESCE(b.plan, 'demo') AS plan
       FROM daycare_contract c
       JOIN institute i ON i.id = c.institute_id
       LEFT JOIN daycare_billing b ON b.institute_id = c.institute_id
      ORDER BY c.draft_generated_at DESC`
  );
  const map = new Map<string, { hasDraft: boolean; isSigned: boolean; plan: string; generatedAt: string | null }>();
  for (const row of rows) {
    const id = String(row.institute_id);
    map.set(id, {
      hasDraft: !!(row.draft_url_ar || row.draft_url_en || row.draft_url),
      isSigned: !!row.signed_url,
      plan: String(row.plan ?? ""),
      generatedAt: row.draft_generated_at ? String(row.draft_generated_at) : null,
    });
  }
  return map;
}

/** Platform operator account ids — the ONLY recipients of the drafts-ready
 *  notification. The daycare owner is deliberately not addressed. */
async function platformOperatorAccountIds(): Promise<string[]> {
  const rows = await queryAll(`SELECT id FROM account WHERE role = 'platform'`);
  return rows.map((r) => String(r.id));
}

/**
 * Generate the AR + EN drafts for one daycare and notify the platform
 * operator(s). Best-effort and idempotent:
 *   * already-generated drafts short-circuit (a retried create or a re-run
 *     never duplicates rows or storage files),
 *   * Storage unconfigured or an upload failure is logged loudly and returns
 *     without writing (no partial row, no orphan half the pair),
 *   * the caller wraps the whole call in its own catch so contract generation
 *     can never break the daycare creation itself.
 */
export async function generateDaycareContractDrafts(input: {
  instituteId: string;
  ownerAccountId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    await ensureSchema();
    const existing = await getDaycareContract(input.instituteId);
    if (existing && (existing.draft_url_ar || existing.draft_url_en || existing.draft_url)) {
      return { ok: false, reason: "draft-exists" };
    }
    const institute = await queryGet("SELECT * FROM institute WHERE id = ?", input.instituteId);
    if (!institute) return { ok: false, reason: "missing-institute" };
    const owner = await queryGet(
      "SELECT full_name, email FROM account WHERE id = ?",
      input.ownerAccountId
    );
    const [{ getDaycareBilling }, templates] = await Promise.all([
      import("@/lib/billing"),
      import("@/lib/contract-templates"),
    ]);
    const billing = await getDaycareBilling(input.instituteId);
    const generatedAt = new Date().toISOString();
    const proposedDate = generatedAt.slice(0, 10);
    const data: ContractDraftData = {
      contractRef: `KIDDY-${input.instituteId}`,
      tradeName: String(institute.name ?? ""),
      tradeAddress: String(institute.address ?? ""),
      tradeSubdomain: String(institute.subdomain ?? ""),
      ownerName: String(owner?.full_name ?? ""),
      ownerEmail: String(owner?.email ?? ""),
      // The single PLATFORM_CONTACT_EMAIL source (lib/site.ts) — the same
      // board-set provider inbox the /contact page names.
      providerNoticeEmail: (await import("@/lib/site")).PLATFORM_CONTACT_EMAIL,
      plan: billing.plan,
      monthlyRateEgp: billing.monthlyRateEgp,
      perChildRateEgp: billing.perChildRateEgp,
      freeChildThreshold: billing.freeChildThreshold,
      annualAmountEgp: billing.annualAmountEgp,
      // The platform bills in EGP only (daycare_billing EGP columns; KID-489).
      currency: "EGP",
      termStart: billing.firstCycleStart,
      proposedDate,
      templateVersion: templates.CONTRACT_TEMPLATE_VERSION,
    };
    const drafts: Array<{ locale: "ar" | "en"; text: string; filename: string }> = [
      {
        locale: "ar",
        text: fillContractTemplate(
          templates.CONTRACT_TEMPLATE_AR,
          contractDraftValues("ar", data)
        ),
        filename: contractDraftStorageFilename(input.instituteId, "ar", crypto.randomUUID()),
      },
      {
        locale: "en",
        text: fillContractTemplate(
          templates.CONTRACT_TEMPLATE_EN,
          contractDraftValues("en", data)
        ),
        filename: contractDraftStorageFilename(input.instituteId, "en", crypto.randomUUID()),
      },
    ];
    // Storage rides the private bucket (contracts are sensitive — the drafts
    // carry the platform's own commercial terms). A fill/upload failure is
    // contained BEFORE the row write: either both drafts are stored and one
    // row appears, or nothing moves.
    const { storageAdminConfigured, getStorageAdmin, PRIVATE_BUCKET, privateRef } = await import("@/lib/storage");
    if (!storageAdminConfigured()) {
      console.error(
        `KID-746 contract drafts skipped (storage unconfigured): daycare=${input.instituteId}`
      );
      return { ok: false, reason: "storage-unconfigured" };
    }
    const urls: { ar?: string; en?: string } = {};
    for (const draft of drafts) {
      const { error } = await getStorageAdmin()
        .storage.from(PRIVATE_BUCKET)
        .upload(draft.filename, draft.text, { contentType: "text/html", upsert: false });
      if (error) {
        console.error(
          `KID-746 contract draft upload failed (${draft.locale}):`,
          error,
          `daycare=${input.instituteId}`
        );
        return { ok: false, reason: "storage-error" };
      }
      urls[draft.locale] = privateRef(draft.filename);
    }
    await setDaycareContractDraft(input.instituteId, {
      templateVersion: data.templateVersion,
      draftUrlAr: urls.ar!,
      draftUrlEn: urls.en!,
      draftGeneratedAt: generatedAt,
    });
    // Operator-only notification: durable row(s) + web push fan-out through
    // the existing pipeline. instituteId stays null so the row is visible on
    // the operator's own notification surface, and the ref is stable per
    // daycare so a replayed generation can never re-notify.
    try {
      const { emitNotifications } = await import("@/lib/store");
      await emitNotifications({
        instituteId: null,
        accountIds: await platformOperatorAccountIds(),
        // The operator prefs pages never disable this surface; 'billing' is
        // the governing activity key (missing prefs rows default enabled).
        activity: "billing",
        kind: "contract_draft",
        payload: {
          daycareId: input.instituteId,
          daycareName: data.tradeName,
          plan: data.plan,
          deepLink: `/platform/daycares/${input.instituteId}/billing`,
        },
        ref: `contract-draft-${input.instituteId}`,
      });
    } catch (err) {
      // The drafts stored; the notification is best-effort — logged, not fatal.
      console.error(`KID-746 operator notification failed (daycare=${input.instituteId}):`, err);
    }
    try {
      const { recordAuditEvent } = await import("@/lib/audit");
      await recordAuditEvent({
        instituteId: input.instituteId,
        actorAccountId: null,
        action: "create",
        entityType: "daycare_contract",
        entityId: input.instituteId,
        summary: "Contract drafts generated (Arabic + English)",
        metadata: { contractDrafts: true, templateVersion: data.templateVersion },
      });
    } catch (err) {
      console.error(`KID-746 audit event failed (daycare=${input.instituteId}):`, err);
    }
    return { ok: true };
  } catch (err) {
    console.error(`KID-746 contract draft generation failed (daycare=${input.instituteId}):`, err);
    return { ok: false, reason: "error" };
  }
}
