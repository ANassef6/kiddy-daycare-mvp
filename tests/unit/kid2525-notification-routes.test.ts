import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let mockCookies: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (mockCookies[name] ? { name, value: mockCookies[name] } : undefined),
  }),
}));

import { createAccount, sessionCookieHeader, type Session } from "@/lib/auth";
import { queryGet, queryRun, uid } from "@/lib/db";
import { parentNotificationHref } from "@/lib/notification-routes";
import { pushDeepUrl } from "@/lib/push";
import { markNotificationRead } from "@/lib/store";
import { resetDb } from "../helpers";

const unique = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}@test.local`;

async function parentAccount(): Promise<string> {
  const account = await createAccount({
    email: unique("parent"),
    password: "parent-pass-1",
    fullName: "Route Parent",
    role: "parent",
  });
  return String(account.id);
}

async function signIn(accountId: string): Promise<void> {
  const session: Session = {
    accountId,
    role: "parent",
    email: "route-parent@test.local",
    emailConfirmed: true,
  };
  const cookie = sessionCookieHeader(session)["Set-Cookie"].split(";")[0]!;
  mockCookies = { kiddy_sess: cookie.split("=").slice(1).join("=") };
}

async function insertNotification(
  accountId: string,
  kind: string,
  payload: Record<string, unknown>,
  id = uid()
): Promise<string> {
  await queryRun(
    `INSERT INTO notification (id, institute_id, account_id, activity, kind, payload, ref)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    null,
    accountId,
    "newsfeed",
    kind,
    JSON.stringify(payload),
    `ref-${id}`
  );
  return id;
}

async function open(id: string): Promise<Response> {
  const { GET } = await import("@/app/api/notifications/open/route");
  return GET(new NextRequest(`https://kiddy.example/api/notifications/open?id=${encodeURIComponent(id)}`));
}

beforeEach(async () => {
  mockCookies = {};
  await resetDb();
});

describe("KID-2525 parent notification route mapping", () => {
  it("opens the newsfeed post that the announcement reports", () => {
    expect(parentNotificationHref("announcement", { postId: "post-1" })).toBe(
      "/child/newsfeed#post-post-1"
    );
    expect(parentNotificationHref("announcement", {})).toBe("/child/newsfeed");
  });

  it("opens the consent and incident rows, not the children list", () => {
    expect(parentNotificationHref("consent", { consentId: "c1" })).toBe(
      "/child/consents#consent-c1"
    );
    expect(parentNotificationHref("consent_request", {})).toBe("/child/consents");
    expect(parentNotificationHref("incident", { incidentId: "i1" })).toBe(
      "/child/incidents#incident-i1"
    );
    expect(parentNotificationHref("incident_created", {})).toBe("/child/incidents");
  });

  it("opens the child attendance section for check-in, check-out and bus events", () => {
    for (const kind of ["check_in", "check_out", "bus_on", "bus_off", "attendance"]) {
      expect(parentNotificationHref(kind, { childId: "child-1" })).toBe(
        "/child/child-1#attendance"
      );
    }
    expect(parentNotificationHref("check_in", {})).toBe("/child/notifications");
  });

  it("keeps every other known notification on its topic", () => {
    expect(parentNotificationHref("message", { threadId: "t 1" })).toBe(
      "/child/messages?thread=t%201"
    );
    expect(parentNotificationHref("message", {})).toBe("/child/messages");
    expect(parentNotificationHref("daily_report", { childId: "child-1" })).toBe(
      "/child/child-1"
    );
    expect(parentNotificationHref("invoice_created", { childId: "child-1" })).toBe(
      "/child/child-1#invoices"
    );
    expect(parentNotificationHref("event", { eventId: "e1" })).toBe(
      "/child/events#event-e1"
    );
    expect(parentNotificationHref("form", { formId: "f1" })).toBe("/child/forms?open=f1");
    expect(parentNotificationHref("chatwoot_message", {})).toBe("/child/support");
  });

  it("never falls back to the child profile for an unknown kind", () => {
    expect(parentNotificationHref("unknown_kind", {})).toBe("/child/notifications");
    expect(pushDeepUrl("unknown_kind", {})).toBe("/child/notifications");
  });

  it("uses the same parent mapping in the push click-through path", () => {
    expect(pushDeepUrl("announcement", { postId: "p1" })).toBe(
      "/child/newsfeed#post-p1"
    );
    expect(pushDeepUrl("consent", { consentId: "c1" })).toBe(
      "/child/consents#consent-c1"
    );
    expect(pushDeepUrl("incident", { incidentId: "i1" })).toBe(
      "/child/incidents#incident-i1"
    );
    expect(pushDeepUrl("check_out", { childId: "child-1" })).toBe(
      "/child/child-1#attendance"
    );
    expect(pushDeepUrl("pickup_time", { childId: "child-1" })).toBe(
      "/portal/children/child-1"
    );
    expect(pushDeepUrl("staff_checkin", { staffId: "staff-1" })).toBe(
      "/portal/staff/staff-1"
    );
  });
});

describe("KID-2525 notification open redirect", () => {
  it("marks the row read and redirects to the mapped topic", async () => {
    const accountId = await parentAccount();
    await signIn(accountId);
    const id = await insertNotification(accountId, "announcement", { postId: "p1" });

    const res = await open(id);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://kiddy.example/child/newsfeed#post-p1");
    const row = await queryGet("SELECT read_at FROM notification WHERE id = ?", id);
    expect(row?.read_at).toBeTruthy();
  });

  it("does not expose another account's notification", async () => {
    const owner = await parentAccount();
    const other = await parentAccount();
    await signIn(owner);
    const id = await insertNotification(other, "announcement", { postId: "p1" });

    const res = await open(id);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://kiddy.example/child/notifications");
    const row = await queryGet("SELECT read_at FROM notification WHERE id = ?", id);
    expect(row?.read_at).toBeNull();
  });

  it("sends a signed-out visitor to login", async () => {
    const accountId = await parentAccount();
    const id = await insertNotification(accountId, "announcement", { postId: "p1" });

    const res = await open(id);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://kiddy.example/login");
  });

  it("marks an unknown kind read and returns to the notification list", async () => {
    const accountId = await parentAccount();
    await signIn(accountId);
    const id = await insertNotification(accountId, "unknown_kind", {});

    const res = await open(id);

    expect(res.headers.get("location")).toBe("https://kiddy.example/child/notifications");
    const row = await queryGet("SELECT read_at FROM notification WHERE id = ?", id);
    expect(row?.read_at).toBeTruthy();
  });
});

describe("KID-2525 read state bridge", () => {
  it("markNotificationRead is idempotent for a row that is already read", async () => {
    const accountId = await parentAccount();
    const id = await insertNotification(accountId, "consent", { consentId: "c1" });
    await markNotificationRead(accountId, id);
    const first = await queryGet("SELECT read_at FROM notification WHERE id = ?", id);
    await markNotificationRead(accountId, id);
    const second = await queryGet("SELECT read_at FROM notification WHERE id = ?", id);
    expect(first?.read_at).toBe(second?.read_at);
  });
});
