// KID-1178/F-06: the abuse budgets on real actions and routes — messaging
// (per-account burst) and the push subscription/test endpoints. Redirect-based
// actions must bounce to /rate-limited; the API routes must answer 429 with
// the JSON error shape the clients already parse.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSessionToken } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";
import { _resetRateLimitForTests, RATE_LIMIT_RULES } from "@/lib/rate-limit";

// lib/push is stubbed at the module boundary the routes/actions consume:
// VAPID configured (so the test-push route reaches its throttle), subscriptions
// saved to the suite's seeded DB, and push fan-out recorded instead of hitting
// the real vendor. Everything else (validators) stays real.
const pushSend = vi.fn(async () => ({ delivered: 1, sent: 1, failed: 0, pruned: 0 }));
vi.mock("@/lib/push", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    vapidConfig: () => true,
    sendPushToAccounts: pushSend,
    savePushSubscription: async () => undefined,
    removePushSubscription: async () => undefined,
  };
});

const sessionState: { token: string | null } = { token: null };

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      sessionState.token && name === "kiddy_sess" ? { name, value: sessionState.token } : undefined,
    set: () => undefined,
  }),
  headers: () => new Headers(),
}));

beforeEach(async () => {
  vi.unstubAllEnvs();
  _resetRateLimitForTests();
  sessionState.token = null;
  pushSend.mockClear();
  await seedFixture();
});

async function mustGet(sql: string): Promise<{ id: unknown; email?: unknown; role?: unknown }> {
  const row = await queryGet(sql);
  if (!row) throw new Error(`fixture row missing: ${sql}`);
  return row as { id: unknown; email?: unknown; role?: unknown };
}

function signIn(row: { id: unknown; email?: unknown; role?: unknown }) {
  sessionState.token = createSessionToken({
    accountId: String(row.id),
    role: String(row.role),
    email: String(row.email),
  } as never);
}

async function expectRedirectTo(run: () => Promise<unknown>, path: string): Promise<void> {
  try {
    await run();
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) {
      expect(digest.split(";")[2]).toBe(path);
      return;
    }
    throw err;
  }
  throw new Error(`expected the call to redirect to ${path}, but it returned normally`);
}

describe("sendMessageAction keeps the per-account messaging budget", () => {
  it("redirects to /rate-limited past the burst window instead of silently no-opping", async () => {
    const owner = await mustGet("SELECT id, email, role FROM account WHERE role = 'owner'");
    const parent = await mustGet("SELECT id FROM account WHERE role = 'parent' LIMIT 1");
    signIn(owner);

    const { sendMessageAction } = await import("@/lib/actions");
    // Consume the whole window. The action's NORMAL completion is its own
    // redirect (to /portal/messages?with=…), which the harness allows.
    const limit = RATE_LIMIT_RULES.messagingAccount.limit;
    for (let i = 0; i < limit; i++) {
      try {
        await sendMessageAction(oneMessageForm(String(parent.id), `kid1178 burst ${i}`));
      } catch (err) {
        const digest = String((err as { digest?: unknown })?.digest ?? "");
        expect(digest.startsWith("NEXT_REDIRECT")).toBe(true);
      }
    }

    await expectRedirectTo(async () => {
      await sendMessageAction(oneMessageForm(String(parent.id), "kid1178 over budget"));
    }, "/rate-limited");
  });
});

function oneMessageForm(recipientId: string, body: string): FormData {
  const fd = new FormData();
  fd.set("recipientId", recipientId);
  fd.set("body", body);
  return fd;
}

describe("POST /api/push/test keeps the per-account budget", () => {
  it("refuses with 429 + Retry-After after the configured sends", async () => {
    const owner = await mustGet("SELECT id, email, role FROM account WHERE role = 'owner'");
    signIn(owner);
    const { POST } = await import("@/app/api/push/test/route");

    expect((await POST()).status).toBe(200);
    for (let i = 1; i < RATE_LIMIT_RULES.pushTestAccount.limit; i++) {
      expect((await POST()).status).toBe(200);
    }
    const refused = await POST();
    expect(refused.status).toBe(429);
    expect(String(refused.headers.get("retry-after") ?? "")).toBeTruthy();
    const body = (await lastJson(refused)) as { error?: { code?: string } } | null;
    expect(body?.error?.code).toBe("rate_limited");
  });
});

async function lastJson(res: Response): Promise<unknown> {
  return res.clone().json();
}

describe("POST /api/push/subscribe keeps the per-account budget", () => {
  it("answers 429 once the subscription-write budget is exhausted", async () => {
    const owner = await mustGet("SELECT id, email, role FROM account WHERE role = 'owner'");
    signIn(owner);
    const { POST } = await import("@/app/api/push/subscribe/route");

    const base = {
      endpoint: "https://push.example/kid1178",
      keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) },
    };
    for (let i = 0; i < RATE_LIMIT_RULES.pushSubscribeAccount.limit; i++) {
      const res = await POST(subscribeRequest({ ...base, endpoint: `${base.endpoint}-${i}` }));
      expect(res.status).toBe(200);
    }
    const refused = await POST(subscribeRequest({ ...base, endpoint: `${base.endpoint}-over` }));
    expect(refused.status).toBe(429);
    expect(String(refused.headers.get("retry-after") ?? "")).toBeTruthy();
    const body = (await lastJson(refused)) as { error?: { code?: string } } | null;
    expect(body?.error?.code).toBe("rate_limited");
  });
});

function subscribeRequest(body: object): NextRequest {
  return new NextRequest("https://kiddy.example/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
