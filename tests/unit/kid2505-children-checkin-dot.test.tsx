// KID-2505: the admin Children page marks each checked-in child's avatar with
// a green dot. The set must come from the same live, center-local-day query the
// attendance board uses (checkedInNow: latest event of the day is a check-in),
// not a per-child lookup. The dot disappears on check-out and carries an EN/AR
// accessible label.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as store from "@/lib/store";
import { createSessionToken, type Session } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { ar, en, tr } from "@/lib/i18n";
import { seedFixture } from "../helpers";

const mockState = vi.hoisted(() => ({
  cookie: "",
  host: "",
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
    get: (name: string) =>
      mockState.cookies[name] ? { name, value: mockState.cookies[name] } : undefined,
    set: () => undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

let iid: string;
let ownerId: string;
let childA: string;
let childB: string;
let firstA: string;
let firstB: string;

async function renderChildren(q = ""): Promise<string> {
  mockState.host = "daycare.test";
  const session: Session = {
    accountId: ownerId,
    role: "owner",
    email: "owner@example.test",
    emailConfirmed: true,
  };
  const token = createSessionToken(session);
  mockState.cookies = { kiddy_sess: token };
  mockState.cookie = `kiddy_sess=${token}`;
  const page = await import("@/app/portal/children/page");
  return renderToStaticMarkup(
    await page.default({ searchParams: Promise.resolve(q ? { q } : {}) })
  );
}

function countDots(html: string): number {
  return (html.match(/avatar-checked-dot/g) ?? []).length;
}

beforeEach(async () => {
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
  const rows = await store.listChildren(iid, { accountId: ownerId });
  childA = String(rows[0].id);
  firstA = String(rows[0].first_name);
  childB = String(rows[1].id);
  firstB = String(rows[1].first_name);
});

afterEach(() => {
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
});

describe("KID-2505 checked-in set derivation", () => {
  it("is exactly the children whose latest day event is a check-in", async () => {
    await store.registerCheckInOut({ childId: childA, accountId: ownerId, type: "in" });
    let ids = new Set((await store.checkedInNow(iid, ownerId)).map((c) => String(c.id)));
    expect(ids).toEqual(new Set([childA]));

    await store.registerCheckInOut({ childId: childA, accountId: ownerId, type: "out" });
    ids = new Set((await store.checkedInNow(iid, ownerId)).map((c) => String(c.id)));
    expect(ids.size).toBe(0);

    // in -> out -> in: the latest event wins, so the child is checked in again.
    await store.registerCheckInOut({ childId: childA, accountId: ownerId, type: "in" });
    ids = new Set((await store.checkedInNow(iid, ownerId)).map((c) => String(c.id)));
    expect(ids.has(childA)).toBe(true);
    expect(ids.has(childB)).toBe(false);
  });
});

describe("KID-2505 Children page dot", () => {
  it("shows one dot for the checked-in child and none for the others", async () => {
    await store.registerCheckInOut({ childId: childA, accountId: ownerId, type: "in" });

    const all = await renderChildren();
    expect(countDots(all)).toBe(1);
    expect(all).toContain('aria-label="Checked in"');
    expect(all).toContain('title="Checked in"');

    // The dot follows the child: searching to that child keeps it, searching
    // to a child who is not checked in shows none.
    expect(countDots(await renderChildren(firstA))).toBe(1);
    expect(countDots(await renderChildren(firstB))).toBe(0);
  });

  it("removes the dot after check-out", async () => {
    await store.registerCheckInOut({ childId: childA, accountId: ownerId, type: "in" });
    expect(countDots(await renderChildren())).toBe(1);

    await store.registerCheckInOut({ childId: childA, accountId: ownerId, type: "out" });
    expect(countDots(await renderChildren())).toBe(0);
  });

  it("renders the Arabic label when the account language is Arabic", async () => {
    await store.registerCheckInOut({ childId: childA, accountId: ownerId, type: "in" });
    await queryRun("UPDATE account SET language = 'ar' WHERE id = ?", ownerId);
    const html = await renderChildren();
    expect(html).toContain(`aria-label="${tr(ar, "childrenAdd.checkedIn")}"`);
    expect(html).toContain(`title="${tr(ar, "childrenAdd.checkedIn")}"`);
  });
});

describe("KID-2505 labels", () => {
  it("ships a translated checked-in label in EN and AR (no raw key)", () => {
    for (const dict of [en, ar]) {
      const label = tr(dict, "childrenAdd.checkedIn");
      expect(label.startsWith("MISSING:")).toBe(false);
      expect(label.trim().length).toBeGreaterThan(0);
    }
    expect(tr(en, "childrenAdd.checkedIn")).toBe("Checked in");
    expect(tr(ar, "childrenAdd.checkedIn")).toBe("حاضر");
  });
});
