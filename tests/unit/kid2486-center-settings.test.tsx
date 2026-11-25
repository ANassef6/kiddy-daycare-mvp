// KID-2486: center settings cleanup.
//
// Pinned here:
//   1. The center settings page no longer mounts the app-language card (the
//      account settings page and the parent settings page keep it, and the
//      card still saves through saveLanguageAction per account).
//   2. The center name is read-only/dimmed here, and saveCenterDetailsAction
//      ignores a tampered name (the stored institute.name never changes).
//   3. Only one name field exists in center settings: the branding card no
//      longer carries a separate "Daycare name", and saveBrandingAction does
//      not write institute.name.
//   4. The platform operator is the only writer: updateDaycareNameAction
//      renames the center (and purges branding), and a non-operator is sent
//      back to /login without a write.
//   5. every branding surface keeps reading institute.name through
//      brandingFromInstitute.
//   6. EN + AR labels ship for the new strings.

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  cookies: {} as Record<string, string>,
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    return new Headers(entries);
  },
  cookies: () => ({
    get: (name: string) =>
      mockState.cookies[name] ? { name, value: mockState.cookies[name] } : undefined,
    set: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
    err.digest = `NEXT_REDIRECT;replace;${url};`;
    throw err;
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { brandingFromInstitute } from "@/lib/theme";
import { dictionaries, keysOf } from "@/lib/i18n";
import { seedFixture } from "../helpers";

let sunshineIid: string;
let ownerId: string;
let ownerEmail: string;
let superadminId: string;

const ROOT = process.cwd();

function formData(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

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
    const match = /NEXT_REDIRECT;replace;([^;]+);/.exec(digest);
    if (match) return match[1];
    throw err;
  }
}

async function instituteRow(): Promise<{ name: string; contact: string | null; primary_color: string }> {
  return (await queryGet(
    "SELECT name, contact, primary_color FROM institute WHERE id = ?",
    sunshineIid
  )) as { name: string; contact: string | null; primary_color: string };
}

const src = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

beforeEach(async () => {
  mockState.cookie = "";
  mockState.cookies = {};
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const owner = (await queryGet("SELECT id, email FROM account WHERE role = 'owner'"))!;
  ownerId = String(owner.id);
  ownerEmail = String(owner.email);
  superadminId = String(
    (await queryGet("SELECT id FROM account WHERE email = 'superadmin@kiddy.test'"))!.id
  );
});

describe("KID-2486: the app-language card leaves center settings", () => {
  it("does not render the language card on the center settings page", async () => {
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const { default: Page } = await import("@/app/portal/settings/page");
    const html = renderToStaticMarkup(
      (await Page({ searchParams: Promise.resolve({}) })) as never
    );
    expect(html).not.toContain("App language");
    expect(html).not.toContain('name="locale"');
    expect(src("app/portal/settings/page.tsx")).not.toContain("LanguageSettingsCard");
  });

  it("keeps account-level switching (account + parent settings still mount it)", () => {
    expect(src("app/portal/account/page.tsx")).toContain("LanguageSettingsCard");
    expect(src("app/child/settings/page.tsx")).toContain("LanguageSettingsCard");
    expect(src("components/LanguageSettingsCard.tsx")).toContain("/switch-app-lang");
  });
});

describe("KID-2486: the center name is read-only in center settings", () => {
  it("renders one dimmed read-only name field and no Daycare name field", async () => {
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const { default: Page } = await import("@/app/portal/settings/page");
    const html = renderToStaticMarkup(
      (await Page({ searchParams: Promise.resolve({}) })) as never
    );
    expect((html.match(/name="name"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<input[^>]*readOnly[^>]*name="name"/i);
    expect(html).not.toContain("Daycare name");
    expect(html).toContain("set by the platform team");
  });

  it("saveCenterDetailsAction ignores a tampered name but saves the other fields", async () => {
    const before = await instituteRow();
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const { saveCenterDetailsAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      saveCenterDetailsAction(
        formData({ name: "Hacked Center", contact: "0100 111 2222", address: "New address" })
      )
    );
    expect(target).toBe("/portal/settings");
    const after = await instituteRow();
    expect(after.name).toBe(before.name);
    expect(after.contact).toBe("0100 111 2222");
  });
});

describe("KID-2486: the branding card no longer duplicates the name", () => {
  it("saveBrandingAction cannot rename the center", async () => {
    const before = await instituteRow();
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const { saveBrandingAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      saveBrandingAction(
        formData({
          name: "Brand Rename",
          primaryColor: "#123456",
          accentColor: "#654321",
          font: "Nunito",
        })
      )
    );
    expect(target).toBe("/portal/settings");
    const after = await instituteRow();
    expect(after.name).toBe(before.name);
    expect(after.primary_color).toBe("#123456");
  });

  it("brandingFromInstitute names the brand from institute.name", async () => {
    const inst = await queryGet("SELECT * FROM institute WHERE id = ?", sunshineIid);
    expect(brandingFromInstitute(inst).name).toBe(String(inst!.name));
  });
});

describe("KID-2486: the platform operator is the only center-name writer", () => {
  it("renames the center from the platform view", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { updateDaycareNameAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      updateDaycareNameAction(
        formData({ instituteId: sunshineIid, name: "Sunshine Learning Center" })
      )
    );
    expect(target).toBe("/platform");
    expect((await instituteRow()).name).toBe("Sunshine Learning Center");
    const audit = await queryGet(
      "SELECT summary FROM audit_event WHERE entity_type = 'institute_settings' ORDER BY created_at DESC LIMIT 1"
    );
    expect(String(audit!.summary ?? "")).toContain("Renamed the center");
  });

  it("refuses a blank name without writing", async () => {
    const before = await instituteRow();
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { updateDaycareNameAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      updateDaycareNameAction(formData({ instituteId: sunshineIid, name: "   " }))
    );
    expect(target).toContain("error=center-name-invalid");
    expect((await instituteRow()).name).toBe(before.name);
  });

  it("a non-operator cannot rename and lands on /login", async () => {
    const before = await instituteRow();
    sessionCookieFor(ownerId, "owner", ownerEmail);
    const { updateDaycareNameAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      updateDaycareNameAction(formData({ instituteId: sunshineIid, name: "Owner Rename" }))
    );
    expect(target).toBe("/login");
    await queryRun("SELECT 1");
    expect((await instituteRow()).name).toBe(before.name);
  });

  it("the platform daycares table carries the per-row rename form", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { default: Page } = await import("@/app/platform/page");
    const html = renderToStaticMarkup(
      (await Page({ searchParams: Promise.resolve({}) })) as never
    );
    expect(html).toContain(`id="center-name-${sunshineIid}"`);
    expect(html).toContain("Save name");
  });
});

describe("KID-2486: EN + AR labels", () => {
  it("every new label exists in both dictionaries", () => {
    const required = [
      "settings.centerNameLockedHint",
      "platform.centerNameLabel",
      "platform.centerNameSave",
      "platform.centerNameInvalid",
    ];
    const enKeys = keysOf(dictionaries.en);
    const arKeys = keysOf(dictionaries.ar);
    for (const key of required) {
      expect(enKeys, `en:${key}`).toContain(key);
      expect(arKeys, `ar:${key}`).toContain(key);
    }
  });
});
