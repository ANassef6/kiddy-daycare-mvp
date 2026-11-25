// KID-2413: regression coverage for the seven KID-2402 QA bugs.
//
// Pinned here (the server-side half QA could not trust before):
//   1. /portal/staff/hours renders the persisted `{open,close}` working-hours
//      objects instead of crashing with "Objects are not valid as a React
//      child", and the day label follows the account language.
//   7. createIncidentAction / createFormAction reject empty input server-side
//      (HTML `required` is bypassable): nothing is written, the action
//      redirects to the submitting page with an error code, and that page
//      renders the localized message.
//   6. the attendance closed-day refusal is rendered from the dictionary in
//      the account's language instead of the English policy literal.

process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({
  token: "" as string,
  host: "" as string,
}));

vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.token) entries.cookie = `kiddy_sess=${mockState.token}`;
    if (mockState.host) entries.host = mockState.host;
    return new Headers(entries);
  },
  cookies: () => ({
    get: (name: string) =>
      name === "kiddy_sess" && mockState.token ? { name, value: mockState.token } : undefined,
    set: () => undefined,
  }),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    redirect: (url: string) => {
      const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
      err.digest = `NEXT_REDIRECT;replace;${url};`;
      throw err;
    },
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
});

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { createSessionToken, setAccountLanguage } from "@/lib/auth";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { ar, tr } from "@/lib/i18n";
import { seedFixture } from "../helpers";

let instituteId: string;
let childId: string;
let ownerId: string;
let parentId: string;

function signIn(cookie: string): void {
  mockState.token = cookie;
}

function ownerCookie(): string {
  return createSessionToken({ accountId: ownerId, role: "owner", email: "trois4ever+admin@gmail.com", emailConfirmed: true } as never);
}

function parentCookie(): string {
  return createSessionToken({ accountId: parentId, role: "parent", email: "parent@example.test", emailConfirmed: true } as never);
}

async function digest(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digestValue = String((err as { digest?: unknown })?.digest ?? "");
    if (digestValue.startsWith("NEXT_REDIRECT")) return digestValue.split(";")[2] ?? "";
    throw err;
  }
  throw new Error("expected the action to redirect");
}

async function countRows(table: string): Promise<number> {
  return Number(((await queryGet(`SELECT COUNT(*) AS n FROM ${table}`)) as { n?: unknown })?.n ?? 0);
}

beforeEach(async () => {
  mockState.token = "";
  mockState.host = "localhost";
  await seedFixture();
  instituteId = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  childId = String((await queryGet("SELECT id FROM child WHERE first_name = 'Ella'"))!.id);
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
  parentId = String((await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id);
});

afterEach(() => {
  mockState.token = "";
  mockState.host = "";
  vi.useRealTimers();
});

describe("KID-2413 bug 1: the working-hours page renders stored DayHours objects", () => {
  it("renders open - close for the object format and never an object child", async () => {
    await queryRun(
      "UPDATE institute SET opening_hours = ? WHERE id = ?",
      JSON.stringify({ "1": { open: "07:00", close: "18:00" } }),
      instituteId
    );
    signIn(ownerCookie());
    const page = await import("@/app/portal/staff/hours/page");
    const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("07:00 - 18:00");
    expect(html).toContain("Monday");
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain("MISSING:");
  });

  it("uses the Arabic day label for an Arabic account", async () => {
    await setAccountLanguage(ownerId, "ar");
    await queryRun(
      "UPDATE institute SET opening_hours = ? WHERE id = ?",
      JSON.stringify({ "1": { open: "07:00", close: "18:00" } }),
      instituteId
    );
    signIn(ownerCookie());
    const page = await import("@/app/portal/staff/hours/page");
    const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(tr(ar, "settings.dayMonday"));
    expect(html).not.toContain("Monday");
  });
});

describe("KID-2413 bug 7: server-side validation for incidents and forms", () => {
  it("createIncidentAction rejects a blank description and writes nothing", async () => {
    signIn(ownerCookie());
    const before = await countRows("incident_report");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("description", "   ");
    const url = await digest(() => import("@/lib/actions").then((m) => m.createIncidentAction(fd)));
    expect(url).toContain("/portal/children/");
    expect(url).toContain("error=incident-description");
    expect(await countRows("incident_report")).toBe(before);
  });

  it("renders the incident validation message in the account language", async () => {
    await setAccountLanguage(ownerId, "ar");
    signIn(ownerCookie());
    const page = await import("@/app/portal/children/[id]/page");
    const html = renderToStaticMarkup(
      await page.default({
        params: Promise.resolve({ id: childId }),
        searchParams: Promise.resolve({ tab: "incident", error: "incident-description" }),
      })
    );
    expect(html).toContain(tr(ar, "profile.incidentDescriptionRequired"));
  });

  it("createFormAction rejects a blank title and writes nothing", async () => {
    signIn(ownerCookie());
    const before = await countRows("form_template");
    const fd = new FormData();
    fd.set("title", "   ");
    fd.set("returnTo", "/portal/surveys");
    const url = await digest(() => import("@/lib/actions").then((m) => m.createFormAction(fd)));
    expect(url).toBe("/portal/surveys?error=form-title");
    expect(await countRows("form_template")).toBe(before);
  });

  it("renders the form validation message in the account language", async () => {
    await setAccountLanguage(ownerId, "ar");
    signIn(ownerCookie());
    const page = await import("@/app/portal/surveys/page");
    const html = renderToStaticMarkup(
      await page.default({ searchParams: Promise.resolve({ error: "form-title" }) })
    );
    expect(html).toContain(tr(ar, "formsAdmin.titleRequired"));
  });
});

describe("KID-2413 bug 6: policy refusals are localized", () => {
  it("returns the closed-day check-in refusal in Arabic for an Arabic account", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // A Sunday — the seeded Sunshine Daycare works Mon-Fri only.
    vi.setSystemTime(new Date("2026-11-08T10:00:00.000Z"));
    await setAccountLanguage(parentId, "ar");
    signIn(parentCookie());
    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "in");
    const result = (await checkInOutAction(fd)) as { error?: string } | undefined;
    const expected = tr(ar, "policy.closedDayNoCheckIn", { day: tr(ar, "settings.daySunday") });
    expect(result?.error).toBe(expected);
    expect(result?.error).not.toContain("closed day");
  });

  it("returns the closed-day pickup refusal in Arabic for an Arabic account", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T10:00:00.000Z"));
    await setAccountLanguage(parentId, "ar");
    signIn(parentCookie());
    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "out");
    fd.set("pickupAt", "2026-11-08T15:00");
    const result = (await checkInOutAction(fd)) as { error?: string } | undefined;
    const expected = tr(ar, "policy.closedDayNoPickup", { day: tr(ar, "settings.daySunday") });
    expect(result?.error).toBe(expected);
    expect(await queryAll("SELECT id FROM check_in WHERE child_id = ? AND type = 'out'", childId)).toEqual([]);
  });
});
