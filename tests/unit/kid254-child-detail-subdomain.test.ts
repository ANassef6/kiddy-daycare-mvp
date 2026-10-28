// KID-254: tapping a child's name on /child did nothing on Android (parent
// report on the deployed daycare subdomain). Root cause pinned here and fixed
// in app/child/[id]/loading.tsx:
//
//   1. The detail route is the heaviest parent surface and the only /child
//      route with NO loading boundary, so Next.js prefetches an empty skeleton
//      for it and the tap navigation stays SILENT — URL and screen unchanged —
//      until the full layout+page RSC round trip finishes (1.7-2.3s warm on
//      production sunshine.<apex>; far worse cold or on cellular). A parent
//      taps and nothing happens; an interrupted fetch dies the same way.
//   2. The route itself must keep resolving on a tenant subdomain host: the
//      KID-212 host resolver serves the host tenant for a parent session, so
//      the failure was never tenancy — the tests below pin that the detail
//      route's guard resolves (no redirect) on the daycare's own subdomain,
//      and that the page renders that child's data under the same request
//      scope.
//
// Test style follows tests/unit/kid212-subdomain.test.ts: the next/headers
// request scope is mocked per test (host + cookie), the local SQLite data
// layer is seeded fresh, and every assertion is on real rendered output.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- request-scope mocks: the page/layout guard read next/headers; tests
// inject the host/cookie per test instead of spinning a server. redirect() is
// mocked to throw the same NEXT_REDIRECT sentinel Next uses, so a bounce to
// /login or /unknown-daycare FAILS the test loudly instead of rendering. ----
let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
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

import * as store from "@/lib/store";
import { createSessionToken } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { resolveRequestTenantFor, requireTenantForPage } from "@/lib/tenant";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";
const SUNSHINE_HOST = `sunshine-daycare.${APEX}`;

let parentAccountId: string;
let childId: string;

beforeEach(async () => {
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  mockHeaders = {};
  await seedFixture();
  const parent = await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'");
  parentAccountId = String(parent!.id);
  const child = await queryGet("SELECT id FROM child WHERE first_name = 'Ella'");
  childId = String(child!.id);
});

afterEach(() => {
  delete process.env.PUBLIC_APEX_DOMAIN;
});

function parentCookie(): string {
  return `kiddy_sess=${encodeURIComponent(
    createSessionToken({ accountId: parentAccountId, role: "parent", email: "parent@example.test", emailConfirmed: true })
  )}`;
}

describe("KID-254: /child/[id] resolves on a daycare subdomain host", () => {
  it("the host resolver serves the host tenant for the parent's session (the detail route's guard)", async () => {
    const rt = await resolveRequestTenantFor(parentCookie(), SUNSHINE_HOST);
    expect(rt).toEqual({ kind: "host", instituteId: rt.instituteId });
    expect(String(rt.instituteId)).not.toBe("");
  });

  it("requireTenantForPage resolves (no redirect to /login or /unknown-daycare) on the tenant host", async () => {
    mockHeaders = { host: SUNSHINE_HOST, cookie: parentCookie() };
    const iid = await requireTenantForPage();
    expect(String(iid)).not.toBe("");
  });

  it("requireTenantForPage bounces a foreign-daycare session off the subdomain (fail closed)", async () => {
    // A parent of a DIFFERENT daycare must never render the detail route here.
    const maple = await store.createDaycare({
      name: "Maple Tree Daycare",
      subdomain: "mapletree",
      ownerEmail: "owner@mapletree.test",
      ownerPassword: "maple-owner-1",
      ownerFullName: "Maple Owner",
    });
    const room = await store.createRoom(maple.instituteId, "Maple Room", 5);
    const mapleChild = await store.createChild({
      instituteId: maple.instituteId,
      firstName: "Maple",
      lastName: "Kid",
      roomId: String(room.id),
    });
    await store.createInvite(maple.instituteId, String(mapleChild.id), "maple-parent@example.test", "MAPLE-1", "parent");
    const { createAccount } = await import("@/lib/auth");
    const foreign = await createAccount({
      email: "maple-parent@example.test",
      password: "kiddy-parent",
      fullName: "Maple Parent",
      role: "parent",
    });
    await store.linkFamily(String(foreign.id), String(mapleChild.id), "parent");
    mockHeaders = { host: SUNSHINE_HOST, cookie: `kiddy_sess=${encodeURIComponent(createSessionToken({ accountId: String(foreign.id), role: "parent", email: "maple-parent@example.test", emailConfirmed: true }))}` };
    await expect(requireTenantForPage()).rejects.toThrow(/NEXT_REDIRECT/);
    void maple;
  });
});

describe("KID-254: the detail route has an instant loading boundary", () => {
  it("app/child/[id]/loading.tsx renders a status skeleton (no silent tap window)", async () => {
    const { default: Loading } = await import("@/app/child/[id]/loading");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(Loading());
    expect(html).toContain('role="status"');
    expect(html).toContain("aria-busy");
  });
});

describe("KID-254: the detail page renders the child under the tenant request scope", () => {
  it("renders Ella's profile for the parent session on sunshine-daycare.<apex>", async () => {
    mockHeaders = { host: SUNSHINE_HOST, cookie: parentCookie() };
    const { default: ChildDetailPage } = await import("@/app/child/[id]/page");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(await ChildDetailPage({ params: { id: childId } }));
    expect(html).toContain("Ella");
    expect(html).toContain("Nguyen");
    // Back link to the list the tap came from.
    expect(html).toContain('href="/child"');
  });

  it("a missing child is a not-found, never another tenant's data", async () => {
    mockHeaders = { host: SUNSHINE_HOST, cookie: parentCookie() };
    const { default: ChildDetailPage } = await import("@/app/child/[id]/page");
    await expect(ChildDetailPage({ params: { id: "no-such-child" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
