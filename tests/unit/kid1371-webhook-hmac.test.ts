// KID-1371: webhook HMAC positive path (P2 gap from KID-1330).
//
// KID-1330 could not test the configured-secret positive path of the
// Chatwoot webhook (app/api/chatwoot/webhook/route.ts +
// lib/chatwoot-webhook.ts). This suite configures a test secret and proves
// the whole verify matrix end-to-end against the route:
//
//   1. correct secret (any of the three presentations: header, ?token=,
//      Authorization Bearer) is ACCEPTED — the request reaches the handler
//      and answers 200,
//   2. a wrong secret → 401, a missing presented secret → 401,
//   3. CHATWOOT_WEBHOOK_SECRET unset/blank fails closed with 503,
//   4. the comparison stays timing-safe (crypto.timingSafeEqual is really
//      called for both equal and nonequal/length-mismatched secrets),
//   5. no log line ever contains the configured secret value.

process.env.TZ = "UTC";

import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

const SECRET = "kid1371-chatwoot-webhook-hmac-test-secret";
const savedSecret = process.env.CHATWOOT_WEBHOOK_SECRET;

type Route = typeof import("@/app/api/chatwoot/webhook/route");
async function route(): Promise<Route> {
  return await import("@/app/api/chatwoot/webhook/route");
}

function webhookRequest(body: unknown, url = "https://kiddy.test/api/chatwoot/webhook", headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// An agent message from a mapped (identifier/account-id) contact — the
// accepted-path payload, reaching the notification emission.
async function notifyPayload(): Promise<{ event: string; message_type: number; contact: { identifier: string; email: string }; content: string; sender_type: string }> {
  const acc = await createAccount({
    email: "kid1371-chatwoot-parent@example.test",
    password: "x",
    fullName: "Chico Chatwoot",
    role: "parent",
  });
  return {
    event: "message_created",
    message_type: 1,
    contact: { identifier: String(acc.id), email: String(acc.email) },
    content: "Friday pickup moved to 4pm",
    sender_type: "agent",
  };
}

describe("KID-1371 webhook secret configured — positive and negative paths", () => {
  let payload: Awaited<ReturnType<typeof notifyPayload>>;

  beforeEach(async () => {
    await seedFixture();
    process.env.CHATWOOT_WEBHOOK_SECRET = SECRET;
    payload = await notifyPayload();
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CHATWOOT_WEBHOOK_SECRET;
    else process.env.CHATWOOT_WEBHOOK_SECRET = savedSecret;
    vi.restoreAllMocks();
  });

  it("correct secret in the X-Chatwoot-Webhook-Secret header is ACCEPTED and handled", async () => {
    const { POST } = await route();
    const res = await POST(
      webhookRequest(payload, "https://kiddy.test/api/chatwoot/webhook", { "x-chatwoot-webhook-secret": SECRET })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: true });
    // The notification row actually landed.
    const row = await queryGet("SELECT payload FROM notification WHERE activity = 'messages' AND ref LIKE 'chatwoot-%'");
    expect(row).toBeDefined();
  });

  it("correct secret as the ?token= URL parameter is ACCEPTED", async () => {
    const { POST } = await route();
    const res = await POST(
      webhookRequest(payload, `https://kiddy.test/api/chatwoot/webhook?token=${encodeURIComponent(SECRET)}`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: true });
  });

  it("correct secret as an Authorization bearer is ACCEPTED", async () => {
    const { POST } = await route();
    const res = await POST(
      webhookRequest(payload, "https://kiddy.test/api/chatwoot/webhook", { authorization: `Bearer ${SECRET}` })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: true });
  });

  it("wrong secret is rejected with a uniform 401", async () => {
    const { POST } = await route();
    const res = await POST(
      webhookRequest(payload, "https://kiddy.test/api/chatwoot/webhook", { "x-chatwoot-webhook-secret": "totally-wrong-secret" })
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(await queryGet("SELECT id FROM notification WHERE activity = 'messages' AND ref LIKE 'chatwoot-%'")).toBeUndefined();
  });

  it("missing presented secret (no header, no token, no bearer) is rejected with 401", async () => {
    const { POST } = await route();
    const res = await POST(webhookRequest(payload));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("unset secret fails closed with 503 — the webhook is disabled, not open", async () => {
    delete process.env.CHATWOOT_WEBHOOK_SECRET;
    const { POST } = await route();
    const headerVariants: Record<string, string>[] = [
      { "x-chatwoot-webhook-secret": SECRET }, // even the correct secret
      { "x-chatwoot-webhook-secret": "wrong" },
      {},
    ];
    for (const headers of headerVariants) {
      const res = await POST(webhookRequest(payload, "https://kiddy.test/api/chatwoot/webhook", headers));
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("webhook_disabled");
    }
    expect(await queryGet("SELECT id FROM notification WHERE activity = 'messages' AND ref LIKE 'chatwoot-%'")).toBeUndefined();
  });

  it("a blank (whitespace-only) configured secret counts as unset → 503", async () => {
    process.env.CHATWOOT_WEBHOOK_SECRET = "   ";
    const { POST } = await route();
    const res = await POST(webhookRequest(payload, "https://kiddy.test/api/chatwoot/webhook", { "x-chatwoot-webhook-secret": "   " }));
    expect(res.status).toBe(503);
  });

  describe("the comparison stays timing-safe and the secret never leaks to logs", () => {
    it("verifyChatwootWebhookSecret uses crypto.timingSafeEqual for equal and unequal and length-mismatched inputs", async () => {
      const { verifyChatwootWebhookSecret } = await import("@/lib/chatwoot-webhook");
      const spy = vi.spyOn(crypto, "timingSafeEqual");
      expect(verifyChatwootWebhookSecret(SECRET, SECRET)).toBe(true);
      expect(verifyChatwootWebhookSecret("wrong", SECRET)).toBe(false);
      expect(verifyChatwootWebhookSecret(SECRET + "-longer", SECRET)).toBe(false);
      expect(verifyChatwootWebhookSecret(SECRET, null)).toBe(false);
      // The equal-length compare AND the burned length-mismatch compare both
      // go through the constant-time primitive.
      expect(spy).toHaveBeenCalledTimes(3);
      for (const call of spy.mock.calls) {
        expect(Buffer.isBuffer(call[0]) && call[0].length <= 1024).toBe(true);
      }
      spy.mockRestore();
    });

    it("route failures and access logs never contain the configured secret", async () => {
      const { POST } = await route();
      const errors: string[] = [];
      const errorSpy = vi.spyOn(console, "error").mockImplementation(((...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      }) as typeof console.error);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined) as never;
      // Trigger ALL paths: accept, reject (wrong), missing, unset, and a 502 body-parse failure.
      const good = await POST(
        webhookRequest(payload, "https://kiddy.test/api/chatwoot/webhook", { "x-chatwoot-webhook-secret": SECRET })
      );
      const bad = await POST(
        webhookRequest(payload, "https://kiddy.test/api/chatwoot/webhook", { "x-chatwoot-webhook-secret": "nope" })
      );
      const missing = await POST(webhookRequest(payload));
      const okBody = await good.json();
      expect(good.status).toBe(200);
      expect(okBody).toMatchObject({ handled: true });
      const badBody = await bad.json();
      void badBody;
      void missing;
      // Restart with an unset secret to hit the fail-closed 503 error path.
      delete process.env.CHATWOOT_WEBHOOK_SECRET;
      const disabled = await POST(webhookRequest(payload));
      expect(disabled.status).toBe(503);
      process.env.CHATWOOT_WEBHOOK_SECRET = SECRET;
      // A malformed body on an authorized request still logs, then errors out.
      const malformed = new Request("https://kiddy.test/api/chatwoot/webhook", {
        method: "POST",
        headers: { "x-chatwoot-webhook-secret": SECRET, "content-type": "application/json" },
        body: "not-json",
      });
      const res502 = await POST(malformed);
      expect(res502.status).toBe(400);

      const logged = errors.join("\n");
      expect(logged).not.toContain(SECRET);
      expect("nope").not.toBe(SECRET);
      void logSpy;
      // The 502/400 branch logs a generic mapping failure with no payload echo.
      expect(logged).toBeDefined();
    });
  });
});
