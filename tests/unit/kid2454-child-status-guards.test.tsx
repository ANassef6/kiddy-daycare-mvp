// KID-2454: the status log must reject a duplicate "Fell asleep" and an
// accidental double-tap SERVER-SIDE. Every negative case below invokes the
// server action directly with a hand-built FormData (the same boundary a raw
// form POST reaches) so the guard is proven on the server, not by UI state.
//
// Pinned here:
//   1. Sleep state: Fell asleep twice with no wake-up in between keeps one row
//      and redirects with error=sleep_state.
//   2. Debounce: the same child/kind/value twice inside 60s keeps one row and
//      redirects with error=duplicate (note differences do not bypass it).
//   3. Woke up → Fell asleep → Woke up still logs every entry.
//   4. Distinct entries (Wet at 17:00, Wet at 18:00) still log.
//   5. Arabic sleep labels are guarded too (the chips submit localized text).
//   6. Both error strings render on the daily tab in EN and AR.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as store from "@/lib/store";
import { createSessionToken, type Session } from "@/lib/auth";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { dictionaries, tr } from "@/lib/i18n";
import { seedFixture } from "../helpers";

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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import ChildPage from "@/app/portal/children/[id]/page";
import { saveChildStatusAction } from "@/lib/actions";

function sessionCookieFor(accountId: string, role: string, email: string): string {
  const session: Session = { accountId, role, email, emailConfirmed: true };
  const token = createSessionToken(session);
  mockState.cookies = { kiddy_sess: token };
  return `kiddy_sess=${token}`;
}

async function targetOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
  throw new Error("expected the action to redirect");
}

function queryOf(target: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(target.split("?")[1] ?? "").entries());
}

let childId: string;
let ownerId: string;
let ownerEmail: string;

beforeEach(async () => {
  await seedFixture();
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  const owner = await queryGet("SELECT id, email FROM account WHERE role = 'owner'");
  ownerId = String(owner!.id);
  ownerEmail = String(owner!.email);
  const iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const child = await store.createChild({ instituteId: iid, firstName: "Lina", lastName: "Kid2454" });
  childId = String(child.id);
  mockState.cookie = sessionCookieFor(ownerId, "owner", ownerEmail);
});

afterEach(() => {
  mockState.cookie = "";
  mockState.cookies = {};
});

function post(fields: Record<string, string>): FormData {
  const form = new FormData();
  form.set("childId", childId);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
}

async function statusCount(): Promise<number> {
  return (await queryAll("SELECT id FROM child_status WHERE child_id = ?", childId)).length;
}

describe("KID-2454 sleep state guard", () => {
  it("rejects a second Fell asleep with no Woke up in between", async () => {
    const first = await targetOf(() => saveChildStatusAction(post({ kind: "sleep", value: "Fell asleep" })));
    expect(queryOf(first).error).toBeUndefined();

    const second = await targetOf(() => saveChildStatusAction(post({ kind: "sleep", value: "Fell asleep" })));
    expect(queryOf(second).tab).toBe("daily");
    expect(queryOf(second).error).toBe("sleep_state");
    expect(await statusCount()).toBe(1);
  });

  it("guards the Arabic chip label the same way", async () => {
    await targetOf(() => saveChildStatusAction(post({ kind: "sleep", value: "خلد إلى النوم" })));
    const second = await targetOf(() => saveChildStatusAction(post({ kind: "sleep", value: "خلد إلى النوم" })));
    expect(queryOf(second).error).toBe("sleep_state");
    expect(await statusCount()).toBe(1);
  });

  it("still logs Woke up → Fell asleep → Woke up", async () => {
    const base = Date.now();
    const at = (seconds: number) => new Date(base + seconds * 1000).toISOString();
    await targetOf(() => saveChildStatusAction(post({ kind: "sleep", value: "Woke up", recordedAt: at(0) })));
    await targetOf(() => saveChildStatusAction(post({ kind: "sleep", value: "Fell asleep", recordedAt: at(5) })));
    await targetOf(() => saveChildStatusAction(post({ kind: "sleep", value: "Woke up", recordedAt: at(10) })));
    expect(await statusCount()).toBe(3);
  });
});

describe("KID-2454 identical-entry debounce", () => {
  it("rejects the same chip twice inside 60 seconds", async () => {
    await targetOf(() => saveChildStatusAction(post({ kind: "diaper", value: "wet" })));
    const second = await targetOf(() => saveChildStatusAction(post({ kind: "diaper", value: "wet" })));
    expect(queryOf(second).error).toBe("duplicate");
    expect(await statusCount()).toBe(1);
  });

  it("does not let a different note bypass the debounce", async () => {
    await targetOf(() => saveChildStatusAction(post({ kind: "mood", value: "happy" })));
    const second = await targetOf(() =>
      saveChildStatusAction(post({ kind: "mood", value: "happy", note: "second tap" }))
    );
    expect(queryOf(second).error).toBe("duplicate");
    expect(await statusCount()).toBe(1);
  });

  it("logs distinct entries outside the window (Wet at 17:00, Wet at 18:00)", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const at = (hour: number) => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
    await targetOf(() => saveChildStatusAction(post({ kind: "diaper", value: "wet", recordedAt: at(17) })));
    await targetOf(() => saveChildStatusAction(post({ kind: "diaper", value: "wet", recordedAt: at(18) })));
    expect(await statusCount()).toBe(2);
  });
});

describe("KID-2454 error surfacing", () => {
  it("ships both messages in EN and AR", () => {
    for (const locale of ["en", "ar"] as const) {
      const dict = dictionaries[locale];
      expect(tr(dict, "profile.statusSleepStateError")).not.toMatch(/MISSING|^profile\./);
      expect(tr(dict, "profile.statusDuplicateError")).not.toMatch(/MISSING|^profile\./);
    }
  });

  it("renders the daily-tab banner for sleep_state and duplicate in English", async () => {
    mockState.cookie = sessionCookieFor(ownerId, "owner", ownerEmail);
    const sleep = renderToStaticMarkup(
      await ChildPage({
        params: Promise.resolve({ id: childId }),
        searchParams: Promise.resolve({ tab: "daily", error: "sleep_state" }),
      })
    ).replace(/&quot;/g, '"');
    expect(sleep).toContain(tr(dictionaries.en, "profile.statusSleepStateError"));
    const dup = renderToStaticMarkup(
      await ChildPage({
        params: Promise.resolve({ id: childId }),
        searchParams: Promise.resolve({ tab: "daily", error: "duplicate" }),
      })
    ).replace(/&quot;/g, '"');
    expect(dup).toContain(tr(dictionaries.en, "profile.statusDuplicateError"));
  });

  it("renders the Arabic banner when the account language is Arabic", async () => {
    await queryRun("UPDATE account SET language = 'ar' WHERE id = ?", ownerId);
    mockState.cookie = sessionCookieFor(ownerId, "owner", ownerEmail);
    const html = renderToStaticMarkup(
      await ChildPage({
        params: Promise.resolve({ id: childId }),
        searchParams: Promise.resolve({ tab: "daily", error: "duplicate" }),
      })
    );
    expect(html).toContain(tr(dictionaries.ar, "profile.statusDuplicateError"));
  });
});
