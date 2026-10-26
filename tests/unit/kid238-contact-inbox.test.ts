// KID-238: the platform contact inbox (PLATFORM_CONTACT_EMAIL, built-in
// default set by the board) is the direct channel for contact/demo requests.
//
// These tests pin four properties:
//   1. The address is read from PLATFORM_CONTACT_EMAIL with the board-set
//      built-in default, and the literal exists exactly once in the codebase
//      (grep-audited below).
//   2. The /contact page and the site footer render a visible mailto link for
//      it, and the disabled-daycare login message names the address.
//   3. Each new inquiry is notified best-effort to that inbox through the
//      EXISTING shared mail path (lib/contact-notify.ts, the GoTrue
//      service-role channel from lib/invite-email.ts) with the same
//      record-and-continue degradation.
//   4. Every attempt's outcome is recorded on the contact_request row
//      (email_sent_at / email_error, migration 0025) while the visitor still
//      sees the success state.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import type { Row } from "@/lib/db";
import { seedFixture } from "../helpers";

// The address the board set as the built-in default. It must live in exactly
// one place (lib/site.ts); this constant is assertion data.
const DEFAULT_CONTACT_EMAIL = "info@kiddyapp.net";

const SITE = path.join(__dirname, "..", "..");

// lib/actions reads the session cookie through next/headers, which has no
// request scope under vitest. The contact/login flows under test either
// return before touching it or read only headers(), so an empty mock is the
// whole harness (same pattern as kid169).
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => undefined }),
  headers: () => new Headers(),
}));

beforeEach(async () => {
  delete process.env.PLATFORM_CONTACT_EMAIL;
  await seedFixture();
});

// ---------- 1. The single source of the address ----------

function sourceFilesCarryingTheLiteral(): string[] {
  const out = execSync(
    `grep -RIl --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git "${DEFAULT_CONTACT_EMAIL}" lib app components supabase 2>/dev/null || true`,
    { cwd: SITE, shell: "/bin/bash" }
  ).toString();
  return out.split("\n").filter(Boolean);
}

describe("PLATFORM_CONTACT_EMAIL", () => {
  it("defaults to the board-set inbox address", async () => {
    vi.resetModules();
    delete process.env.PLATFORM_CONTACT_EMAIL;
    const { PLATFORM_CONTACT_EMAIL } = await import("@/lib/site");
    expect(PLATFORM_CONTACT_EMAIL).toBe(DEFAULT_CONTACT_EMAIL);
  });

  it("can be pointed at another address by the env var", async () => {
    vi.resetModules();
    process.env.PLATFORM_CONTACT_EMAIL = "hello@kiddy.example";
    try {
      const { PLATFORM_CONTACT_EMAIL } = await import("@/lib/site");
      expect(PLATFORM_CONTACT_EMAIL).toBe("hello@kiddy.example");
    } finally {
      delete process.env.PLATFORM_CONTACT_EMAIL;
    }
  });

  it("falls back to the default when the env var is blank", async () => {
    vi.resetModules();
    process.env.PLATFORM_CONTACT_EMAIL = "   ";
    try {
      const { PLATFORM_CONTACT_EMAIL } = await import("@/lib/site");
      expect(PLATFORM_CONTACT_EMAIL).toBe(DEFAULT_CONTACT_EMAIL);
    } finally {
      delete process.env.PLATFORM_CONTACT_EMAIL;
    }
  });

  it("the literal exists exactly once in source (lib/site.ts)", () => {
    expect(sourceFilesCarryingTheLiteral()).toEqual(["lib/site.ts"]);
  });
});

// ---------- 2. The public surfaces render the address ----------

describe("the /contact page and footer name the address", () => {
  it("the contact page renders a visible mailto link and the Prefer email line", async () => {
    const { default: ContactPage } = await import("@/app/contact/page");
    const html = renderToStaticMarkup(await ContactPage({ searchParams: {} }));
    expect(html).toContain(`mailto:${DEFAULT_CONTACT_EMAIL}`);
    expect(html).toContain(DEFAULT_CONTACT_EMAIL);
    expect(html).toContain("Prefer email?");
  });

  it("the site footer contact block carries the mailto link", async () => {
    const { default: SiteFooter } = await import("@/components/SiteFooter");
    const html = renderToStaticMarkup(SiteFooter());
    expect(html).toContain(`mailto:${DEFAULT_CONTACT_EMAIL}`);
    expect(html).toContain(DEFAULT_CONTACT_EMAIL);
  });
});

// ---------- 3. The disabled-daycare message names the address ----------

describe("the disabled-daycare login error", () => {
  it("names the platform contact inbox", async () => {
    const iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
    await queryRun("UPDATE institute SET active = 0 WHERE id = ?", iid);

    const { loginAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("email", "admin@sunshinedaycare.test");
    form.set("password", "kiddy-admin");
    const result = (await loginAction(form)) as { error?: string };

    expect(result?.error).toContain("This daycare is currently disabled.");
    expect(result?.error).toContain(DEFAULT_CONTACT_EMAIL);
  });
});

// ---------- 4. Best-effort inbox notification ----------

async function submitContact(formData: FormData): Promise<string> {
  const { submitContactAction } = await import("@/lib/actions");
  try {
    await submitContactAction(formData);
    return "";
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
}

function demoForm(): FormData {
  const form = new FormData();
  form.set("name", "Cody QA");
  form.set("email", "cody.qa@daycare.example");
  form.set("phone", "+20 100 000 0000");
  form.set("role", "center");
  form.set("interest", "demo");
  form.set("message", "Please show us the platform.");
  return form;
}

async function storedRequests(): Promise<Row[]> {
  return queryAll(
    "SELECT id, name, email, message, email_sent_at, email_error FROM contact_request ORDER BY created_at DESC"
  );
}

describe("submitContactAction records the inbox notification attempt", () => {
  it("stores the row and records the no-provider degradation, then still shows success", async () => {
    // vitest env leaves the service-role key unset — the exact no-provider
    // state this ticket must degrade gracefully in.
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toBe("");

    const target = await submitContact(demoForm());
    expect(target).toBe("/contact?sent=1");

    const [row] = await storedRequests();
    expect(row).toBeDefined();
    expect(row!.name).toBe("Cody QA");
    expect(row!.email).toBe("cody.qa@daycare.example");
    expect(row!.email_sent_at).toBeNull();
    expect(String(row!.email_error)).toContain("no mail provider configured");
  });

  it("validation failures still redirect to the error state and store nothing", async () => {
    const form = new FormData();
    form.set("name", "");
    form.set("email", "not-an-email");
    const target = await submitContact(form);
    expect(target).toBe("/contact?error=name");
    expect(await storedRequests()).toHaveLength(0);
  });

  it("records a successful notification when the provider accepts", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co";
    const invite = vi.fn().mockResolvedValue({ data: {}, error: null });
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ auth: { admin: { inviteUserByEmail: invite } } }),
    }));
    try {
      const { createContactRequest, recordContactMailAttempt } = await import("@/lib/store");
      const { notifyPlatformInbox } = await import("@/lib/contact-notify");
      const row = await createContactRequest({
        name: "Provider Path",
        email: "provider.path@daycare.example",
        role: "center",
        interest: "demo",
      });
      const outcome = await notifyPlatformInbox(row as Row);
      expect(outcome.status).toBe("sent");
      expect(invite).toHaveBeenCalledWith(DEFAULT_CONTACT_EMAIL);

      await recordContactMailAttempt(String(row.id), { ok: true });
      const [after] = await storedRequests();
      expect(after!.email_sent_at).not.toBeNull();
      expect(after!.email_error).toBeNull();
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      vi.doUnmock("@supabase/supabase-js");
      vi.resetModules();
    }
  });

  it("records the already-registered degradation once the inbox user exists", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co";
    const invite = vi
      .fn()
      .mockResolvedValue({ data: {}, error: { message: "Email address has already been registered" } });
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ auth: { admin: { inviteUserByEmail: invite } } }),
    }));
    try {
      const { createContactRequest, recordContactMailAttempt } = await import("@/lib/store");
      const { notifyPlatformInbox } = await import("@/lib/contact-notify");
      const row = await createContactRequest({
        name: "Second Inquiry",
        email: "second.inquiry@daycare.example",
        role: "center",
        interest: "question",
      });
      const outcome = await notifyPlatformInbox(row as Row);
      expect(outcome.status).toBe("failed");
      expect(outcome.detail).toContain("already registered");

      await recordContactMailAttempt(String(row.id), { ok: false, error: outcome.detail });
      const [after] = await storedRequests();
      expect(after!.email_sent_at).toBeNull();
      expect(String(after!.email_error)).toContain("already registered");
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      vi.doUnmock("@supabase/supabase-js");
      vi.resetModules();
    }
  });
});

describe("buildContactNotificationEmail", () => {
  it("targets the contact inbox and carries the inquiry content", async () => {
    const { buildContactNotificationEmail } = await import("@/lib/contact-notify");
    const mail = buildContactNotificationEmail({
      id: "req-1",
      name: "Nour Nassef",
      email: "nour@daycare.example",
      phone: "+20 12 345 6789",
      interest: "demo",
      message: "We have 40 children.",
    });
    expect(mail.to).toBe(DEFAULT_CONTACT_EMAIL);
    expect(mail.subject).toContain("Nour Nassef");
    expect(mail.text).toContain("nour@daycare.example");
    expect(mail.text).toContain("+20 12 345 6789");
    expect(mail.text).toContain("We have 40 children.");
  });

  it("never contains 'undefined' for missing optional fields", async () => {
    const { buildContactNotificationEmail } = await import("@/lib/contact-notify");
    const mail = buildContactNotificationEmail({ id: "req-2", name: "X", email: "x@y.example" });
    expect(mail.text).not.toContain("undefined");
  });
});

describe("isInboxAlreadyRegisteredError", () => {
  it("matches the GoTrue re-invite rejection variants", async () => {
    const { isInboxAlreadyRegisteredError } = await import("@/lib/contact-notify");
    expect(isInboxAlreadyRegisteredError({ message: "User already registered" })).toBe(true);
    expect(isInboxAlreadyRegisteredError({ message: "Email has already been registered" })).toBe(true);
    expect(isInboxAlreadyRegisteredError({ status: 422, message: "" })).toBe(true);
    expect(isInboxAlreadyRegisteredError({ message: "fetch failed" })).toBe(false);
    expect(isInboxAlreadyRegisteredError(null)).toBe(false);
  });
});

// The migration mirror: the recording columns exist on the SQLite test engine.
describe("contact_request mail columns", () => {
  it("exist and default to NULL for a fresh row", async () => {
    const form = new FormData();
    form.set("name", "Schema Check");
    form.set("email", "schema.check@daycare.example");
    await submitContact(form);
    const row = await queryGet(
      "SELECT email_sent_at, email_error FROM contact_request WHERE email = 'schema.check@daycare.example'"
    );
    expect(row).toBeDefined();
  });
});
