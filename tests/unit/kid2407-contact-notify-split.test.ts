// KID-2407: contact/demo requests must actually reach the team.
//
// Board decision (KID-215): notifications are delivered to a hidden address
// (bluen.dev@gmail.com) while info@kiddyapp.net remains the only address shown
// anywhere in the UI. The operator chose the smallest possible change: keep
// the existing Supabase GoTrue invite channel, only retarget it to
// PLATFORM_CONTACT_NOTIFY_EMAIL. No new mail vendor, no operator signup, no
// visitor confirmation.
//
// These tests pin:
//   1. delivery and display are separate constants,
//   2. the hidden address never reaches a rendered page or a client bundle,
//   3. the notification targets the hidden address through the existing
//      channel,
//   4. the GoTrue one-shot limitation is recorded, not hidden,
//   5. an unset provider degrades to record + continue.

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { queryAll } from "@/lib/db";
import type { Row } from "@/lib/db";
import { seedFixture } from "../helpers";

const PUBLIC_EMAIL = "info@kiddyapp.net";
const HIDDEN_NOTIFY_EMAIL = "bluen.dev@gmail.com";
const SITE = path.join(__dirname, "..", "..");

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => undefined }),
  headers: () => new Headers(),
}));

beforeEach(async () => {
  delete process.env.PLATFORM_CONTACT_EMAIL;
  delete process.env.PLATFORM_CONTACT_NOTIFY_EMAIL;
  await seedFixture();
});

// ---------- 1. Delivery is separate from display ----------

describe("delivery vs display addresses", () => {
  it("defaults the notify address to the board-set mailbox", async () => {
    const { contactNotifyEmail } = await import("@/lib/contact-notify");
    expect(contactNotifyEmail()).toBe(HIDDEN_NOTIFY_EMAIL);
  });

  it("accepts a deployment override and ignores a blank value", async () => {
    const { contactNotifyEmail } = await import("@/lib/contact-notify");
    process.env.PLATFORM_CONTACT_NOTIFY_EMAIL = "team@kiddy.example";
    expect(contactNotifyEmail()).toBe("team@kiddy.example");
    process.env.PLATFORM_CONTACT_NOTIFY_EMAIL = "   ";
    expect(contactNotifyEmail()).toBe(HIDDEN_NOTIFY_EMAIL);
  });

  it("keeps the public display address on info@kiddyapp.net", async () => {
    const { PLATFORM_CONTACT_EMAIL } = await import("@/lib/site");
    expect(PLATFORM_CONTACT_EMAIL).toBe(PUBLIC_EMAIL);
  });
});

// ---------- 2. The hidden address never leaks ----------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function isClientModule(file: string): boolean {
  return /^\s*["']use client["']\s*;?/m.test(read(file));
}

// A "use server" module is replaced by action references in the client graph:
// Next does not bundle its imports, so the closure stops here.
function isServerActionModule(file: string): boolean {
  return /^\s*["']use server["']\s*;?/m.test(read(file));
}

function resolveImport(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SITE, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = path.join(base, "index" + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const body = read(file);
  const specs = [
    ...body.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g),
  ].map((m) => m[1]!);
  return specs;
}

// Every module reachable from a "use client" entry point is what Next bundles
// for the browser (a proxy for the real build, which does not exist at test
// time). The hidden address must not be in that closure.
function clientModuleClosure(): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const root of ["app", "components"]) {
    for (const file of walk(path.join(SITE, root))) {
      if (isClientModule(file)) queue.push(file);
    }
  }
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (isServerActionModule(file)) continue;
    for (const spec of importsOf(file)) {
      const resolved = resolveImport(spec, file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

describe("the hidden notify address never reaches the UI or a client bundle", () => {
  it("the literal lives only in the server-only contact-notify module", () => {
    const offenders: string[] = [];
    for (const root of ["lib", "app", "components", "supabase"]) {
      for (const file of walk(path.join(SITE, root))) {
        if (read(file).includes(HIDDEN_NOTIFY_EMAIL)) {
          offenders.push(path.relative(SITE, file).replace(/\\/g, "/"));
        }
      }
    }
    expect(offenders).toEqual(["lib/contact-notify.ts"]);
  });

  it("no client module (nor anything it imports) reaches lib/contact-notify.ts", () => {
    const closure = clientModuleClosure();
    const offender = [...closure].find(
      (file) => path.relative(SITE, file).replace(/\\/g, "/") === "lib/contact-notify.ts"
    );
    expect(offender).toBeUndefined();
    for (const file of closure) {
      expect(read(file)).not.toContain(HIDDEN_NOTIFY_EMAIL);
    }
  });

  it("PLATFORM_CONTACT_NOTIFY_EMAIL is read only by the server-only notifier", () => {
    const offenders: string[] = [];
    for (const root of ["lib", "app", "components"]) {
      for (const file of walk(path.join(SITE, root))) {
        if (file.endsWith("contact-notify.ts")) continue;
        if (read(file).includes("PLATFORM_CONTACT_NOTIFY_EMAIL")) {
          offenders.push(path.relative(SITE, file).replace(/\\/g, "/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a built client bundle, when one exists, does not contain it", () => {
    const staticDir = path.join(SITE, ".next", "static");
    if (!fs.existsSync(staticDir)) return; // tests normally run before a build
    const offenders = walk(staticDir).filter((file) => read(file).includes(HIDDEN_NOTIFY_EMAIL));
    expect(offenders).toEqual([]);
  });
});

// ---------- 3. Rendered public pages and portal banners ----------

describe("rendered marketing and portal surfaces", () => {
  it("no marketing page renders the hidden address", async () => {
    const pages = await Promise.all([
      import("@/app/page"),
      import("@/app/features/page"),
      import("@/app/for-parents/page"),
      import("@/app/for-centers/page"),
    ]);
    const html = [
      renderToStaticMarkup(await pages[0]!.default()),
      renderToStaticMarkup(await pages[1]!.default()),
      renderToStaticMarkup(await pages[2]!.default()),
      renderToStaticMarkup(await pages[3]!.default()),
    ];
    for (const page of html) {
      expect(page).not.toContain(HIDDEN_NOTIFY_EMAIL);
    }
  });

  it("the contact page still renders the public address, never the hidden one", async () => {
    const { default: ContactPage } = await import("@/app/contact/page");
    const html = renderToStaticMarkup(await ContactPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(PUBLIC_EMAIL);
    expect(html).toContain(`mailto:${PUBLIC_EMAIL}`);
    expect(html).not.toContain(HIDDEN_NOTIFY_EMAIL);
  });

  it("both disabled/blocked banners name the public address only", async () => {
    const { tenancyDisabledMessage } = await import("@/lib/i18n");
    for (const reason of ["manual", "billing"] as const) {
      for (const lang of ["en", "ar"]) {
        const message = tenancyDisabledMessage(reason, lang);
        expect(message).toContain(PUBLIC_EMAIL);
        expect(message).not.toContain(HIDDEN_NOTIFY_EMAIL);
      }
    }
  });
});

// ---------- 4. Delivery through the existing channel ----------

function demoRow(overrides: Record<string, unknown> = {}): Row {
  return {
    id: "req-kid2407",
    name: "Cody QA",
    email: "cody.qa@daycare.example",
    phone: "+20 100 000 0000",
    role: "center",
    interest: "demo",
    message: "Please show us the platform.",
    ...overrides,
  } as Row;
}

const PROVIDER_ENV = {
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
};

function setProviderEnv() {
  Object.assign(process.env, PROVIDER_ENV);
}

function clearProviderEnv() {
  for (const key of Object.keys(PROVIDER_ENV)) delete process.env[key];
}

describe("team notification delivery", () => {
  it("targets the hidden address and carries the full inquiry", async () => {
    setProviderEnv();
    const invite = vi.fn().mockResolvedValue({ data: {}, error: null });
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ auth: { admin: { inviteUserByEmail: invite } } }),
    }));
    try {
      const { notifyPlatformInbox, buildContactNotificationEmail } = await import(
        "@/lib/contact-notify"
      );
      const mail = buildContactNotificationEmail(demoRow());
      expect(mail.to).toBe(HIDDEN_NOTIFY_EMAIL);
      expect(mail.subject).toContain("Cody QA");
      expect(mail.text).toContain("cody.qa@daycare.example");
      expect(mail.text).toContain("+20 100 000 0000");
      expect(mail.text).toContain("demo");
      expect(mail.text).toContain("Please show us the platform.");
      expect(mail.text).toContain("req-kid2407");

      const outcome = await notifyPlatformInbox(demoRow());
      expect(outcome.status).toBe("sent");
      expect(invite).toHaveBeenCalledWith(HIDDEN_NOTIFY_EMAIL);
    } finally {
      clearProviderEnv();
      vi.doUnmock("@supabase/supabase-js");
      vi.resetModules();
    }
  });

  it("honours a deployment override of the notify address", async () => {
    setProviderEnv();
    process.env.PLATFORM_CONTACT_NOTIFY_EMAIL = "team@kiddy.example";
    const invite = vi.fn().mockResolvedValue({ data: {}, error: null });
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ auth: { admin: { inviteUserByEmail: invite } } }),
    }));
    try {
      const { notifyPlatformInbox } = await import("@/lib/contact-notify");
      await notifyPlatformInbox(demoRow());
      expect(invite).toHaveBeenCalledWith("team@kiddy.example");
    } finally {
      delete process.env.PLATFORM_CONTACT_NOTIFY_EMAIL;
      clearProviderEnv();
      vi.doUnmock("@supabase/supabase-js");
      vi.resetModules();
    }
  });

  it("records GoTrue's one-shot limitation instead of pretending to send", async () => {
    setProviderEnv();
    const invite = vi
      .fn()
      .mockResolvedValue({ data: {}, error: { message: "Email address has already been registered" } });
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ auth: { admin: { inviteUserByEmail: invite } } }),
    }));
    try {
      const { notifyPlatformInbox } = await import("@/lib/contact-notify");
      const outcome = await notifyPlatformInbox(demoRow());
      expect(outcome.status).toBe("failed");
      expect(outcome.detail).toContain("already registered");
      expect(invite).toHaveBeenCalledWith(HIDDEN_NOTIFY_EMAIL);
    } finally {
      clearProviderEnv();
      vi.doUnmock("@supabase/supabase-js");
      vi.resetModules();
    }
  });
});

// ---------- 5. Degradation + row hygiene ----------

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

async function storedRow(): Promise<Row | undefined> {
  const rows = await queryAll(
    "SELECT id, email_sent_at, email_error FROM contact_request ORDER BY created_at DESC"
  );
  return rows[0];
}

describe("no provider configured", () => {
  it("returns pending without a network call", async () => {
    const inviteModule = vi.fn();
    vi.doMock("@supabase/supabase-js", () => {
      inviteModule();
      return { createClient: () => ({ auth: { admin: { inviteUserByEmail: vi.fn() } } }) };
    });
    try {
      const { notifyPlatformInbox } = await import("@/lib/contact-notify");
      const outcome = await notifyPlatformInbox(demoRow());
      expect(outcome.status).toBe("pending");
      expect(outcome.detail).toContain("no mail provider configured");
      expect(inviteModule).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@supabase/supabase-js");
      vi.resetModules();
    }
  });
});

describe("submitContactAction records the notification attempt", () => {
  it("still shows success and records the degrade outcome", async () => {
    const target = await submitContact(demoForm());
    expect(target).toBe("/contact?sent=1");
    const row = await storedRow();
    expect(row!.email_sent_at).toBeNull();
    expect(String(row!.email_error)).toContain("no mail provider configured");
  });
});
