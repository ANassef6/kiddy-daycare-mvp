// KID-2403: the daycare name is platform-managed, and branding images can be
// cleared from account settings.
//
// Pinned here:
//   1. saveBrandingAction ignores a submitted `name` (colors/font still save),
//      so a crafted POST cannot rename the center from a daycare session.
//   2. saveCenterDetailsAction ignores a submitted `name` too (contact and
//      address still save).
//   3. updateDaycareNameAction is platform-only: an owner/admin POST lands on
//      /login; the operator can rename, the value is trimmed, empty and
//      over-120 names are rejected, and only institute.name changes.
//   4. removeBrandingImageAction nulls exactly the requested column, leaves the
//      other image intact, and refuses an unknown `kind`.
//   5. The new copy exists in EN and AR (parity is enforced by i18n.test.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- request-scope mock (kid489/kid490 pattern): actions read cookies() for
// the session and headers() for the tenant; redirect() throws the sentinel so
// a refusal/landing fails loudly instead of rendering. ---
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    redirect: (url: string) => {
      const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
      err.digest = `NEXT_REDIRECT;replace;${url};`;
      throw err;
    },
  };
});

import { createSessionToken } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let sunshineIid: string;
let sunshineAdminId: string;
let operatorId: string;

function formData(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

function sessionFor(accountId: string, email: string, role: string): void {
  const token = createSessionToken({ accountId, email, role, emailConfirmed: true });
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
    const msg = String((err as Error)?.message ?? "");
    if (msg.startsWith("NEXT_REDIRECT: ")) return msg.slice("NEXT_REDIRECT: ".length);
    throw err;
  }
}

async function instituteRow(): Promise<Record<string, unknown>> {
  return (await queryGet("SELECT * FROM institute WHERE id = ?", sunshineIid)) as Record<string, unknown>;
}

beforeEach(async () => {
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const admin = await queryGet("SELECT id FROM account WHERE email = 'trois4ever+admin@gmail.com'");
  sunshineAdminId = String(admin!.id);
  const op = await queryGet("SELECT id FROM account WHERE email = 'superadmin@kiddy.test'");
  operatorId = String(op!.id);
});

describe("KID-2403: saveBrandingAction ignores a submitted name", () => {
  it("keeps the stored name but writes the colors and font", async () => {
    const before = await instituteRow();
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { saveBrandingAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      saveBrandingAction(
        formData({
          name: "Crafted Rename",
          primaryColor: "#112233",
          accentColor: "#445566",
          font: "Poppins",
        })
      )
    );
    expect(target).toBe("/portal/settings");
    const after = await instituteRow();
    expect(String(after.name)).toBe(String(before.name));
    expect(String(after.primary_color)).toBe("#112233");
    expect(String(after.accent_color)).toBe("#445566");
    expect(String(after.font)).toBe("Poppins");
  });
});

describe("KID-2403: saveCenterDetailsAction ignores a submitted name", () => {
  it("keeps the stored name but writes contact and address", async () => {
    const before = await instituteRow();
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { saveCenterDetailsAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      saveCenterDetailsAction(
        formData({ name: "Crafted Rename", contact: "+20 100 111 2222", address: "12 Nile Street" })
      )
    );
    expect(target).toBe("/portal/settings");
    const after = await instituteRow();
    expect(String(after.name)).toBe(String(before.name));
    expect(String(after.contact)).toBe("+20 100 111 2222");
    expect(String(after.address)).toBe("12 Nile Street");
  });
});

describe("KID-2403: updateDaycareNameAction is platform-only", () => {
  it("refuses an owner/admin session and leaves the name unchanged", async () => {
    const before = await instituteRow();
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { updateDaycareNameAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      updateDaycareNameAction(formData({ instituteId: sunshineIid, name: "Owner Rename" }))
    );
    expect(target).toBe("/login");
    expect(String((await instituteRow()).name)).toBe(String(before.name));
  });

  it("lets the operator rename, trims the value, and changes nothing else", async () => {
    const before = await instituteRow();
    sessionFor(operatorId, "superadmin@kiddy.test", "platform");
    const { updateDaycareNameAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      updateDaycareNameAction(formData({ instituteId: sunshineIid, name: "  Sunshine Academy  " }))
    );
    expect(target).toBe("/platform");
    const after = await instituteRow();
    expect(String(after.name)).toBe("Sunshine Academy");
    expect(String(after.subdomain)).toBe(String(before.subdomain));
    expect(String(after.primary_color)).toBe(String(before.primary_color));
    expect(String(after.accent_color)).toBe(String(before.accent_color));
  });

  it("rejects an empty name and a name over 120 characters", async () => {
    const before = await instituteRow();
    sessionFor(operatorId, "superadmin@kiddy.test", "platform");
    const { updateDaycareNameAction } = await import("@/lib/actions");
    expect(
      await redirectTargetFor(() => updateDaycareNameAction(formData({ instituteId: sunshineIid, name: "   " })))
    ).toBe("/platform?error=rename-empty");
    expect(
      await redirectTargetFor(() =>
        updateDaycareNameAction(formData({ instituteId: sunshineIid, name: "x".repeat(121) }))
      )
    ).toBe("/platform?error=rename-too-long");
    const after = await instituteRow();
    expect(String(after.name)).toBe(String(before.name));
  });
});

describe("KID-2403: removeBrandingImageAction clears one image", () => {
  async function setBothImages(): Promise<void> {
    await queryRun(
      "UPDATE institute SET logo_url = ?, brand_image_url = ? WHERE id = ?",
      "https://cdn.example.test/logo.png",
      "https://cdn.example.test/brand.png",
      sunshineIid
    );
  }

  it("removes only the logo and leaves the brand image", async () => {
    await setBothImages();
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { removeBrandingImageAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      removeBrandingImageAction(formData({ kind: "logo" }))
    );
    expect(target).toBe("/portal/settings");
    const after = await instituteRow();
    expect(after.logo_url).toBeNull();
    expect(String(after.brand_image_url)).toBe("https://cdn.example.test/brand.png");
  });

  it("removes only the brand image and leaves the logo", async () => {
    await setBothImages();
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { removeBrandingImageAction } = await import("@/lib/actions");
    await redirectTargetFor(() => removeBrandingImageAction(formData({ kind: "brandImage" })));
    const after = await instituteRow();
    expect(String(after.logo_url)).toBe("https://cdn.example.test/logo.png");
    expect(after.brand_image_url).toBeNull();
  });

  it("refuses an unknown kind without touching either column", async () => {
    await setBothImages();
    sessionFor(sunshineAdminId, "trois4ever+admin@gmail.com", "owner");
    const { removeBrandingImageAction } = await import("@/lib/actions");
    await redirectTargetFor(() => removeBrandingImageAction(formData({ kind: "avatar" })));
    const after = await instituteRow();
    expect(String(after.logo_url)).toBe("https://cdn.example.test/logo.png");
    expect(String(after.brand_image_url)).toBe("https://cdn.example.test/brand.png");
  });
});

describe("KID-2403: EN/AR copy", () => {
  it("ships every new settings and platform key in both locales", () => {
    for (const key of [
      "nameReadonlyHint",
      "remove",
      "removeLogo",
      "removeBrandImage",
    ] as const) {
      expect(dictionaries.en.settings[key].trim().length).toBeGreaterThan(0);
      expect(dictionaries.ar.settings[key].trim().length).toBeGreaterThan(0);
      expect(dictionaries.ar.settings[key]).not.toBe(dictionaries.en.settings[key]);
    }
    for (const key of [
      "rename",
      "renameHint",
      "renameSave",
      "renameEmpty",
      "renameTooLong",
      "renameMissing",
    ] as const) {
      expect(dictionaries.en.platform[key].trim().length).toBeGreaterThan(0);
      expect(dictionaries.ar.platform[key].trim().length).toBeGreaterThan(0);
      expect(dictionaries.ar.platform[key]).not.toBe(dictionaries.en.platform[key]);
    }
  });
});
