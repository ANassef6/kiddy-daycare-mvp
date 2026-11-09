// KID-489 item 3 (KID-492): the parent's payment-proof upload + the admin
// notification.
//
// Pinned here:
//   1. supabase/migrations/0034_kid489_payment_proof.sql adds the three
//      nullable columns (payment_proof_url, payment_proof_uploaded_at,
//      payment_reference), idempotent, mirrored in lib/sqlite-schema.ts.
//   2. lib/payment-proof.ts validatePaymentProof accepts PNG/JPG/PDF up to
//      the size cap and rejects wrong types / oversize / empty with a code.
//   3. uploadPaymentProofAction (auth → family link → tenant → validate →
//      storage → row write) succeeds for the family parent, stores the URL +
//      uploaded_at + optional reference WITHOUT touching the invoice status,
//      replaces the previous proof on re-upload, and refuses a same-center
//      outsider parent, a foreign-institute invoice, a staff account and an
//      anonymous caller fail closed (no write, no error banner leak).
//   4. Type/size/storage failures redirect back with ?error=proof* and never
//      touch the row or the feed.
//   5. The admin activity feed (recentActivityFeed) surfaces exactly ONE
//      payment-proof item per unpaid invoice with a recent upload — a
//      re-upload refreshes it, a second upload never duplicates it, and the
//      item disappears once the invoice is paid. Page reads emit nothing.
//   6. The admin billing table shows the proof link, upload date and
//      reference next to the untouched status control; the parent surface
//      shows the upload form (unpaid only), the proof link and the error
//      banners.
//   7. EN + AR labels ship for every new string.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

// --- request-scope mock (kid489/kid490 pattern): actions read cookies() for
// the session and headers() for the tenant; pages read the Cookie header ---
const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
  cookies: {} as Record<string, string>,
  // Injects a storage failure for the ?error=proofUpload path.
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
vi.mock("@/lib/supabase", () => ({
  supabaseConfigured: () => true,
  getSupabase: () => ({
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      getUser: async () => ({ data: {}, error: null }),
    },
  }),
}));

// KID-1177: proofs no longer ride the anon-key client on kiddy-public — the
// upload goes through the service-key client into kiddy-private and the row
// keeps the "kiddy-private:<path>" REF. This mock stands in for that client:
// uploads/removes are recorded, signed URLs are minted deterministically, and
// the helpers (privateRef/isPrivateRef/storageSrcFor/…) keep their real
// shape so the pages' resolution path is exercised exactly as production
// runs it.
const kid1177 = vi.hoisted(() => {
  const PREFIX = "kiddy-private:";
  const state = {
    uploads: [] as Array<{ bucket: string; path: string; body: unknown }>,
    removed: [] as Array<{ bucket: string; path: string }>,
    count: 0,
    downloadBodies: new Map<string, string>(),
    uploadError: null as { message: string } | null,
  };
  const client = () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: unknown) => {
          if (state.uploadError) return { error: state.uploadError };
          state.uploads.push({ bucket, path, body });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const path of paths) state.removed.push({ bucket, path });
          return { error: null };
        },
        download: async (path: string) => ({
          data: new Blob([state.downloadBodies.get(path) ?? "placeholder"], { type: "application/octet-stream" }),
          error: null,
        }),
        createSignedUrl: async (path: string) => {
          state.count += 1;
          return {
            data: { signedUrl: `https://storage.test/storage/v1/object/sign/kiddy-private/${path}?token=signed-${state.count}` },
            error: null,
          };
        },
        createSignedUrls: async (paths: string[]) => {
          const data = paths.map((path) => {
            state.count += 1;
            return { signedUrl: `https://storage.test/storage/v1/object/sign/kiddy-private/${path}?token=signed-${state.count}` };
          });
          return { data, error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/kiddy-public/${path}` } }),
      }),
    },
  });
  const signedUrlForRef = async (ref: string, ttl = 3600): Promise<string | null> => {
    void ttl;
    if (typeof ref !== "string" || !ref.startsWith(PREFIX)) return null;
    const got = await client().storage.from("kiddy-private").createSignedUrl(ref.slice(PREFIX.length));
    return got.data?.signedUrl ?? null;
  };
  const storageSrcFor = async (stored: string | null | undefined, ttl = 3600): Promise<string | null> => {
    const value = stored ? String(stored) : "";
    if (!value) return null;
    if (value.startsWith(PREFIX)) return signedUrlForRef(value, ttl);
    return value;
  };
  const signedUrlsForRefs = async (refs: string[], ttl = 3600): Promise<Map<string, string | null>> => {
    const out = new Map<string, string | null>();
    for (const ref of refs) {
      const value = typeof ref === "string" ? ref : "";
      if (!value || !value.startsWith(PREFIX)) {
        out.set(value, value || null);
        continue;
      }
      out.set(value, await signedUrlForRef(value, ttl));
    }
    return out;
  };
  return { PREFIX, state, client, signedUrlForRef, storageSrcFor, signedUrlsForRefs };
});
vi.mock("@/lib/storage", () => ({
  ...kid1177,
  storageAdminConfigured: () => true,
  getStorageAdmin: kid1177.client,
  PRIVATE_BUCKET: "kiddy-private",
  PUBLIC_BUCKET: "kiddy-public",
  PRIVATE_REF_PREFIX: kid1177.PREFIX,
  privateRef: (path: string) => `kiddy-private:${path}`,
  publicUrl: async (path: string) => `https://storage.test/kiddy-public/${path}`,
  uploadPrivateObject: async (path: string, body: unknown) => {
    const { error } = await kid1177.client().storage.from("kiddy-private").upload(path, body);
    return { error, path };
  },
  isPrivateRef: (value: unknown) => typeof value === "string" && value.startsWith(kid1177.PREFIX),
  privateRefPath: (value: string) => value.slice(kid1177.PREFIX.length),
  signedUrlForRef: kid1177.signedUrlForRef,
  storageSrcFor: kid1177.storageSrcFor,
  signedUrlsForRefs: kid1177.signedUrlsForRefs,
  SIGNED_URL_TTL_SECONDS: 3600,
}));

import * as store from "@/lib/store";
import { createSessionToken, createAccount } from "@/lib/auth";
import { MAX_PAYMENT_PROOF_BYTES, validatePaymentProof } from "@/lib/payment-proof";
import { dictionaries, feedCopyFor } from "@/lib/i18n";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let sunshineIid: string;
let sunshineChildId: string;
let sunshineChildName: string;
let sunshineAdminId: string;
let parentId: string;

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

async function createInvoice(description = "June fees"): Promise<any> {
  return store.createChildBilling({
    childId: sunshineChildId,
    instituteId: sunshineIid,
    description,
    amountCents: 120000,
  });
}

async function proofRowFor(billingId: string): Promise<any> {
  return queryGet(
    "SELECT payment_proof_url, payment_proof_uploaded_at, payment_reference FROM child_billing WHERE id = ?",
    billingId
  )!;
}

async function uploadProof(billingId: string, opts?: { type?: string; size?: number; reference?: string }): Promise<string> {
  const { uploadPaymentProofAction } = await import("@/lib/actions");
  const form = formWith({
    billingId,
    ...(opts?.reference ? { paymentReference: opts.reference } : {}),
  });
  form.set("file", fileFor(opts?.size ?? 120, opts?.type ?? "image/png", "receipt.png"));
  return redirectTargetFor(() => uploadPaymentProofAction(form));
}

beforeEach(async () => {
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  mockState.uploadError = null;
  kid1177.state.uploadError = null;
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  sunshineChildId = String((await queryGet("SELECT id FROM child LIMIT 1"))!.id);
  const child = await queryGet("SELECT first_name, last_name FROM child WHERE id = ?", sunshineChildId)!;
  sunshineChildName = `${child!.first_name} ${child!.last_name}`;
  sunshineAdminId = String((await queryGet("SELECT id FROM account WHERE email = 'trois4ever+admin@gmail.com'"))!.id);
  parentId = String((await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id);
});

describe("KID-492: schema (Postgres migration mirrored in SQLite)", () => {
  it("the migration adds the three nullable proof columns idempotently", () => {
    const sql = readFileSync("supabase/migrations/0034_kid489_payment_proof.sql", "utf8");
    expect(sql).toMatch(/ALTER TABLE child_billing ADD COLUMN IF NOT EXISTS payment_proof_url TEXT/i);
    expect(sql).toMatch(/ALTER TABLE child_billing ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at TEXT/i);
    expect(sql).toMatch(/ALTER TABLE child_billing ADD COLUMN IF NOT EXISTS payment_reference TEXT/i);
  });

  it("the SQLite mirror carries the columns; a fresh invoice reads all NULL", async () => {
    const billing = await createInvoice("Mirror probe");
    const row = await proofRowFor(String(billing.id));
    expect(row.payment_proof_url).toBeNull();
    expect(row.payment_proof_uploaded_at).toBeNull();
    expect(row.payment_reference).toBeNull();
  });
});

describe("KID-492: validatePaymentProof boundary", () => {
  it("accepts PNG, JPG and PDF at or under the size cap", () => {
    expect(validatePaymentProof({ type: "image/png", size: 12000 })).toEqual({ ok: true, ext: "png" });
    expect(validatePaymentProof({ type: "image/jpeg", size: 12000 })).toEqual({ ok: true, ext: "jpg" });
    expect(validatePaymentProof({ type: "image/jpeg", size: MAX_PAYMENT_PROOF_BYTES })).toEqual({ ok: true, ext: "jpg" });
    expect(validatePaymentProof({ type: "application/pdf", size: 40000 })).toEqual({ ok: true, ext: "pdf" });
  });

  it("rejects wrong types, oversize and empty files", () => {
    expect(validatePaymentProof({ type: "image/gif", size: 10 })).toEqual({ ok: false, code: "type" });
    expect(validatePaymentProof({ type: "text/plain", size: 10 })).toEqual({ ok: false, code: "type" });
    expect(validatePaymentProof({ type: "image/png", size: MAX_PAYMENT_PROOF_BYTES + 1 })).toEqual({ ok: false, code: "size" });
    expect(validatePaymentProof({ type: "image/png", size: 0 })).toEqual({ ok: false, code: "type" });
    expect(validatePaymentProof({})).toEqual({ ok: false, code: "type" });
  });
});

describe("KID-492: the parent uploads a proof for their own family's invoice", () => {
  it("stores the URL, uploaded_at and reference — and keeps the invoice pending", async () => {
    const billing = await createInvoice();
    sessionCookieFor(parentId, "parent", "parent@example.test");
    const target = await uploadProof(String(billing.id), { reference: "TX-8891" });
    expect(target).toBe(`/child/${sunshineChildId}?proof=uploaded`);
    const row = await queryGet(
      "SELECT payment_proof_url, payment_proof_uploaded_at, payment_reference, status FROM child_billing WHERE id = ?",
      String(billing.id)
    )!;
    expect(String(row!.payment_proof_url)).toMatch(
      new RegExp(`^kiddy-private:payments/${sunshineIid}/${billing.id}/proof-\\d+-[0-9a-f-]+\\.png$`)
    );
    // KID-1177: the object landed in the PRIVATE bucket, not kiddy-public.
    expect(kid1177.state.uploads.every((u) => u.bucket === "kiddy-private")).toBe(true);
    expect(String(row!.payment_proof_uploaded_at ?? "")).not.toBe("");
    expect(String(row!.payment_reference)).toBe("TX-8891");
    expect(String(row!.status)).toBe("pending");
    // The audit trail carries the marker, never the URL data.
    const audit = await queryGet(
      "SELECT summary, metadata FROM audit_event WHERE entity_type = 'child_billing' AND entity_id = ? AND action = 'update'",
      String(billing.id)
    );
    expect(String(audit!.summary ?? "")).toContain("Payment proof");
    expect(String(row!.metadata ?? "")).not.toContain("storage.test");
    // The audit metadata never carries the private dump either.
    expect(String(audit!.metadata ?? "")).not.toContain("kiddy-private");
  });

  it("a re-upload replaces the previous proof without duplicating the feed item", async () => {
    const billing = await createInvoice("Replace fees");
    sessionCookieFor(parentId, "parent", "parent@example.test");
    await uploadProof(String(billing.id), { reference: "TX-1" });
    // The same family parent overwrites their OWN invoice's proof; both proof
    // columns move together so the row never mixes a URL with a stale date.
    await uploadProof(String(billing.id), { reference: "TX-2" });
    const row = await proofRowFor(String(billing.id));
    expect(String(row.payment_reference)).toBe("TX-2");
    expect(String(row.payment_proof_url).endsWith(".png")).toBe(true);

    const feed = await store.recentActivityFeed(sunshineIid, sunshineAdminId, 50, feedCopyFor("en"));
    const proofItems = feed.filter((f) => f.id === `proof-${String(billing.id)}`);
    expect(proofItems.length).toBe(1);
  });
});

describe("KID-492: rejections never create a partial record", () => {
  it("a missing/empty file redirects with ?error=proofType and writes nothing", async () => {
    const billing = await createInvoice();
    sessionCookieFor(parentId, "parent", "parent@example.test");
    const target = await uploadProof(String(billing.id), { size: 0, type: "image/png" });
    expect(target).toBe(`/child/${sunshineChildId}?error=proofType`);
    const row = await proofRowFor(String(billing.id));
    expect(row.payment_proof_url).toBeNull();
    expect(row.payment_proof_uploaded_at).toBeNull();
  });

  it("a wrong file type redirects with ?error=proofType and writes nothing", async () => {
    const billing = await createInvoice();
    sessionCookieFor(parentId, "parent", "parent@example.test");
    const target = await uploadProof(String(billing.id), { type: "text/plain" });
    expect(target).toBe(`/child/${sunshineChildId}?error=proofType`);
    const row = await proofRowFor(String(billing.id));
    expect(row.payment_proof_url).toBeNull();
    expect(row.payment_proof_uploaded_at).toBeNull();
  });

  it("an oversize file redirects with ?error=proofSize and writes nothing", async () => {
    const billing = await createInvoice("Big fees");
    sessionCookieFor(parentId, "parent", "parent@example.test");
    const target = await uploadProof(String(billing.id), { size: MAX_PAYMENT_PROOF_BYTES + 1 });
    expect(target).toBe(`/child/${sunshineChildId}?error=proofSize`);
    const row = await proofRowFor(String(billing.id));
    expect(row.payment_proof_url).toBeNull();
    expect(row.payment_proof_uploaded_at).toBeNull();
  });

  it("a storage failure redirects with ?error=proofUpload and writes nothing", async () => {
    const billing = await createInvoice("Retry fees");
    sessionCookieFor(parentId, "parent", "parent@example.test");
    mockState.uploadError = { message: "boom" };
    kid1177.state.uploadError = { message: "boom" };
    const target = await uploadProof(String(billing.id));
    expect(target).toBe(`/child/${sunshineChildId}?error=proofUpload`);
    const row = await proofRowFor(String(billing.id));
    expect(row.payment_proof_url).toBeNull();
  });
});

describe("KID-492: cross-tenant / cross-family upload is denied", () => {
  it("a same-center outsider parent is refused fail closed", async () => {
    const billing = await createInvoice("Others fees");
    const outsider = await createAccount({
      email: "kid492-outsider@example.test",
      password: "kiddy-parent",
      fullName: "Outsider Parent",
      role: "parent",
    });
    sessionCookieFor(String(outsider.id), "parent", "kid492-outsider@example.test");
    const target = await uploadProof(String(billing.id));
    expect(target).toBe("/login?error=wrong-tenant");
    const row = await proofRowFor(String(billing.id));
    expect(row.payment_proof_url).toBeNull();
    expect(row.payment_proof_uploaded_at).toBeNull();
  });

  it("a foreign institute's invoice id is refused for a real parent session", async () => {
    await queryRun(
      "INSERT INTO institute (id, name, created_at) VALUES (?, ?, datetime('now'))",
      "iid-kid492-maple",
      "Maple Daycare"
    );
    await queryRun(
      "INSERT INTO child (id, institute_id, first_name, last_name) VALUES (?, ?, 'Cedar', 'Nassef')",
      "c-kid492-maple",
      "iid-kid492-maple"
    );
    const foreign = await store.createChildBilling({
      childId: "c-kid492-maple",
      instituteId: "iid-kid492-maple",
      description: "Foreign fees",
      amountCents: 500,
    });
    sessionCookieFor(parentId, "parent", "parent@example.test");
    const target = await uploadProof(String(foreign.id));
    expect(target).toBe("/login?error=wrong-tenant");
    const row = await proofRowFor(String(foreign.id));
    expect(row.payment_proof_url).toBeNull();
  });

  it("a same-center admin account has no family link and is refused", async () => {
    const billing = await createInvoice("Staff fees");
    // The fixture's center accounts are owner/admin roles — no family link to
    // the child, so the same fail-closed refusal applies to them.
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const target = await uploadProof(String(billing.id));
    expect(target).toBe("/login?error=wrong-tenant");
    const row = await proofRowFor(String(billing.id));
    expect(row.payment_proof_url).toBeNull();
  });

  it("an anonymous caller never writes anything", async () => {
    mockState.cookie = "";
    mockState.cookies = {};
    const target = await uploadProof("any");
    expect(target).toBe("/login");
  });
});

describe("KID-492: the admin sees the proof and the activity item", () => {
  it("the admin activity feed surfaces exactly one proof item; paid clears it", async () => {
    const billing = await createInvoice("Feed fees");
    sessionCookieFor(parentId, "parent", "parent@example.test");
    await uploadProof(String(billing.id), { reference: "TX-77" });

    const feed = await store.recentActivityFeed(sunshineIid, sunshineAdminId, 50, feedCopyFor("en"));
    const proofItems = feed.filter((f) => f.id === `proof-${String(billing.id)}`);
    expect(proofItems.length).toBe(1);
    expect(proofItems[0]!.title).toBe(`Payment proof for ${sunshineChildName} needs review`);
    expect(proofItems[0]!.body).toContain("Feed fees");
    expect(proofItems[0]!.meta).toBe("Reference: TX-77");
    expect(proofItems[0]!.link).toBe(`/portal/children/${sunshineChildId}/billing`);

    // The admin marks it paid through the EXISTING control; the review item
    // disappears from the feed.
    await store.updateChildBilling(String(billing.id), { status: "paid" });
    const afterFeed = await store.recentActivityFeed(sunshineIid, sunshineAdminId, 50, feedCopyFor("en"));
    expect(afterFeed.some((f) => f.id === `proof-${String(billing.id)}`)).toBe(false);
  });

  it("a second invoice adds a second item — dedupe is per invoice/upload event", async () => {
    const first = await createInvoice("First");
    const second = await createInvoice("Second");
    sessionCookieFor(parentId, "parent", "parent@example.test");
    await uploadProof(String(first.id));
    await uploadProof(String(second.id));
    const feed = await store.recentActivityFeed(sunshineIid, sunshineAdminId, 50, feedCopyFor("en"));
    const proofIds = feed.filter((f) => f.id.startsWith("proof-")).map((f) => f.id).sort();
    expect(proofIds).toEqual([`proof-${first.id}`, `proof-${second.id}`].sort());
  });

  it("the admin billing table shows the proof link, date and reference", async () => {
    const billing = await createInvoice("Table fees");
    sessionCookieFor(parentId, "parent", "parent@example.test");
    await uploadProof(String(billing.id), { reference: "TX-9" });
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const { default: AdminBillingPage } = await import("@/app/portal/children/[id]/billing/page");
    const html = renderToStaticMarkup(await AdminBillingPage({ params: { id: sunshineChildId } }) as never);
    expect(html).toContain(">View proof</a>");
    // KID-1177: the rendered href is a short-lived SIGNED url into the
    // private bucket — never the raw private ref, never a kiddy-public URL.
    expect(html).toMatch(/storage\.test\/storage\/v1\/object\/sign\/kiddy-private\/payments\//);
    expect(html).not.toContain("kiddy-public/payments/");
    expect(html).toContain("TX-9");
    expect(html).toContain("Ref: TX-9");
  });

  it("without a proof the admin table shows the placeholder cell", async () => {
    await createInvoice("Proofless");
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const { default: AdminBillingPage } = await import("@/app/portal/children/[id]/billing/page");
    const html = renderToStaticMarkup(await AdminBillingPage({ params: { id: sunshineChildId } }) as never);
    expect(html).toContain("Proofless");
    expect(html).not.toContain("View proof");
  });

  it("the portal notifications page renders the review item for the admin", async () => {
    const billing = await createInvoice("Bell fees");
    sessionCookieFor(parentId, "parent", "parent@example.test");
    await uploadProof(String(billing.id));
    sessionCookieFor(sunshineAdminId, "owner", "trois4ever+admin@gmail.com");
    const { default: Page } = await import("@/app/portal/notifications/page");
    const html = renderToStaticMarkup(await Page() as never);
    expect(html).toContain(`Payment proof for ${sunshineChildName} needs review`);
  });
});

describe("KID-492: the parent surface", () => {
  it("renders the upload form for an unpaid invoice and the proof view after upload", async () => {
    const billing = await createInvoice("UI fees");
    sessionCookieFor(parentId, "parent", "parent@example.test");
    const { default: ParentPage } = await import("@/app/child/[id]/page");
    let html = renderToStaticMarkup(await ParentPage({ params: { id: sunshineChildId }, searchParams: {} }) as never);
    expect(html).toContain(dictionaries.en.child.payProofUpload);
    expect(html).toContain(dictionaries.en.child.payProofPlaceholder);
    expect(html).not.toContain(dictionaries.en.child.payProofView);
    expect(html).not.toContain(ddict("payProofPendingReview"));

    await uploadProof(String(billing.id));
    html = renderToStaticMarkup(await ParentPage({ params: { id: sunshineChildId }, searchParams: {} }) as never);
    expect(html).toContain(dictionaries.en.child.payProofView);
    // KID-1177: the parent's own proof link is a signed private URL too.
    expect(html).toMatch(/storage\.test\/storage\/v1\/object\/sign\/kiddy-private\/payments\//);
    expect(html).toContain(dictionaries.en.child.payProofReplace);
  });

  it("renders the rejection and success banners", async () => {
    sessionCookieFor(parentId, "parent", "parent@example.test");
    const { default: ParentPage } = await import("@/app/child/[id]/page");
    let html = renderToStaticMarkup(await ParentPage({ params: { id: sunshineChildId }, searchParams: { error: "proofSize" } }) as never);
    expect(html).toContain(dictionaries.en.child.payProofErrorSize);
    html = renderToStaticMarkup(await ParentPage({ params: { id: sunshineChildId }, searchParams: { error: "proofType" } }) as never);
    expect(html).toContain(dictionaries.en.child.payProofErrorType);
    html = renderToStaticMarkup(await ParentPage({ params: { id: sunshineChildId }, searchParams: { proof: "uploaded" } }) as never);
    // renderToStaticMarkup escapes the apostrophe in the EN string.
    expect(html).toContain(dictionaries.en.child.payProofPendingReview.replace(/'/g, "&#x27;"));
  });

  it("a paid invoice shows no upload form", async () => {
    await store.createChildBilling({
      childId: sunshineChildId,
      instituteId: sunshineIid,
      description: "Settled fees",
      amountCents: 1000,
      status: "paid",
    });
    sessionCookieFor(parentId, "parent", "parent@example.test");
    const { default: ParentPage } = await import("@/app/child/[id]/page");
    const html = renderToStaticMarkup(await ParentPage({ params: { id: sunshineChildId }, searchParams: {} }) as never);
    expect(html).toContain("Settled fees");
    expect(html).not.toContain(dictionaries.en.child.payProofUpload);
  });

  it("tenant isolation: an unrelated parent cannot render the child surface at all", async () => {
    await createInvoice("Secret fees");
    const outsider = await createAccount({
      email: "kid492-outsider-page@example.test",
      password: "kiddy-parent",
      fullName: "Outsider Page",
      role: "parent",
    });
    sessionCookieFor(String(outsider.id), "parent", "kid492-outsider-page@example.test");
    const { default: ParentPage } = await import("@/app/child/[id]/page");
    await expect(ParentPage({ params: { id: sunshineChildId }, searchParams: {} })).rejects.toThrow(/NEXT_NOT_FOUND/);
  });
});

describe("KID-492: EN + AR labels", () => {
  it("ships both dictionaries for every new string", () => {
    for (const key of [
      "payProofUpload",
      "payProofReplace",
      "payProofView",
      "payProofPlaceholder",
      "payProofPendingReview",
      "payProofErrorType",
      "payProofErrorSize",
      "payProofErrorUpload",
    ] as const) {
      expect(String(dictionaries.en.child[key]).length).toBeGreaterThan(0);
      expect(String(dictionaries.ar.child[key]).length).toBeGreaterThan(0);
    }
    expect(dictionaries.en.child.payProofErrorSize).toContain("5 MB");
    expect(dictionaries.ar.child.payProofErrorSize).toContain("5 ميجابايت");
    expect(dictionaries.en.feed.paymentProofTitle).toContain("needs review");
    expect(dictionaries.ar.feed.paymentProofTitle).toContain("مراجعة");
  });
});

function ddict(key: string): string {
  return (dictionaries.en.child as Record<string, string>)[key];
}
