// KID-1178/F-06: the rate-limit engine — fixed windows, the auth attempt
// budget, and the progressive per-account lockout. The engine runs its rules
// on the memory store in tests (the Upstash REST backend is exercised by the
// same engine — only the transport differs — and is wired by env in the
// deployment).

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RATE_LIMIT_RULES,
  _resetRateLimitForTests,
  authAttemptGuard,
  clientIpFrom,
  hashIdentity,
  recordAuthFailure,
  recordAuthSuccess,
  rateLimitBackend,
  throttle,
} from "@/lib/rate-limit";

beforeEach(() => {
  vi.unstubAllEnvs();
  _resetRateLimitForTests();
});

describe("the store backend selection", () => {
  it("runs in-process when no Redis REST env is wired", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(rateLimitBackend()).toBe("memory");
  });
});

describe("throttle (fixed-window counter)", () => {
  it("admits exactly the configured number of requests, then refuses with a Retry-After", async () => {
    const rule = { limit: 3, windowSec: 60 };
    for (let i = 0; i < 3; i++) {
      expect((await throttle("t", rule, "caller-A")).ok).toBe(true);
    }
    const refused = await throttle("t", rule, "caller-A");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.retryAfterSec).toBeGreaterThan(0);
      expect(refused.retryAfterSec).toBeLessThanOrEqual(60);
      expect(refused.rule).toContain("t:");
    }
  });

  it("opens again when the window rolls over", async () => {
    const rule = { limit: 2, windowSec: 60 };
    await throttle("t2", rule, "caller-B");
    await throttle("t2", rule, "caller-B");
    expect((await throttle("t2", rule, "caller-B")).ok).toBe(false);

    const now = Date.now();
    const later = now + 61 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      expect((await throttle("t2", rule, "caller-B")).ok).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("isolates identities and surfaces (per-key, never shared)", async () => {
    const rule = { limit: 1, windowSec: 60 };
    expect((await throttle("t3", rule, "caller-C")).ok).toBe(true);
    expect((await throttle("t3", rule, "caller-D")).ok).toBe(true);
    expect((await throttle("other", rule, "caller-C")).ok).toBe(true);
    expect((await throttle("t3", rule, "caller-C")).ok).toBe(false);
  });
});

describe("authAttemptGuard + lockout", () => {
  it("keeps the per-IP attempt budget separate from the per-account lockout", async () => {
    // The default 30/300s IP budget first…
    for (let i = 0; i < RATE_LIMIT_RULES.loginIp.limit; i++) {
      expect((await authAttemptGuard("login", "1.2.3.4", "victim@example.test")).ok).toBe(true);
    }
    const ipBlocked = await authAttemptGuard("login", "1.2.3.4", "victim@example.test");
    expect(ipBlocked.ok).toBe(false);
    if (!ipBlocked.ok) expect(ipBlocked.scope).toBe("ip");
    // …and only after 5 verified failures does the account itself lock.
    const fresh = "9.9.9.9";
    for (let i = 0; i < RATE_LIMIT_RULES.loginAccount.failureThreshold; i++) {
      expect((await authAttemptGuard("login", fresh, "victim@example.test")).ok).toBe(true);
      await recordAuthFailure("login", fresh, "victim@example.test");
    }
    const accBlocked = await authAttemptGuard("login", fresh, "victim@example.test");
    expect(accBlocked.ok).toBe(false);
    if (!accBlocked.ok) {
      expect(accBlocked.scope).toBe("account");
      expect(accBlocked.retryAfterSec).toBeGreaterThan(0);
      expect(accBlocked.retryAfterSec).toBeLessThanOrEqual(
        RATE_LIMIT_RULES.loginAccount.backoffSteps[0]
      );
    }
  });

  it("escalates the lockout with each failure tier, verified against the clock", async () => {
    const ip = "8.8.8.8";
    const email = "lock@example.test";
    const steps = RATE_LIMIT_RULES.loginAccount.backoffSteps;
    const threshold = RATE_LIMIT_RULES.loginAccount.failureThreshold;
    for (let i = 0; i < threshold; i++) {
      expect((await authAttemptGuard("login", ip, email)).ok).toBe(true);
      await recordAuthFailure("login", ip, email);
    }
    // Tier 1, immediate: the lock right after the 5th failure is ~60s.
    const immediate = await authAttemptGuard("login", ip, email);
    expect(immediate.ok).toBe(false);
    if (!immediate.ok) {
      expect(immediate.retryAfterSec).toBeGreaterThan(0);
      expect(immediate.retryAfterSec).toBeLessThanOrEqual(steps[0] + 1);
    }

    // Each lock expires (time-travel forward past its step); the next verified
    // failure advances the tier. Immediately after the SECOND threshold
    // (10 failures) the lock has escalated to the next step (120s)…
    const realNow = Date.now();
    let lastRetry = 0;
    for (let n = threshold + 1; n <= 2 * threshold; n++) {
      vi.spyOn(Date, "now").mockReturnValue(realNow + n * (steps[0] + 1) * 1000);
      expect((await authAttemptGuard("login", ip, email)).ok).toBe(true);
      await recordAuthFailure("login", ip, email);
      const locked = await authAttemptGuard("login", ip, email);
      if (locked.ok) throw new Error(`expected tier at ${n} failures to hold`);
      lastRetry = locked.retryAfterSec;
    }
    vi.restoreAllMocks();
    expect(lastRetry).toBeGreaterThan(steps[1] - 5);
    expect(lastRetry).toBeLessThanOrEqual(steps[1] + 1);
  });

  it("a successful login clears the account counter — normal users are not punished", async () => {
    const ip = "7.7.7.7";
    for (let i = 0; i < RATE_LIMIT_RULES.loginAccount.failureThreshold - 1; i++) {
      expect((await authAttemptGuard("login", ip, "fine@example.test")).ok).toBe(true);
      await recordAuthFailure("login", ip, "fine@example.test");
    }
    await recordAuthSuccess("Fine@example.test");
    for (let i = 0; i < RATE_LIMIT_RULES.loginAccount.failureThreshold - 1; i++) {
      expect((await authAttemptGuard("login", ip, "fine@example.test")).ok).toBe(true);
      await recordAuthFailure("login", ip, "fine@example.test");
    }
    expect((await authAttemptGuard("login", ip, "fine@example.test")).ok).toBe(true);
  });

  it("counts case-insensitively on the account identity but keeps different accounts apart", async () => {
    const ip = "5.5.5.5";
    for (let i = 0; i < RATE_LIMIT_RULES.loginAccount.failureThreshold; i++) {
      expect((await authAttemptGuard("login", ip, "User@example.test")).ok).toBe(true);
      await recordAuthFailure("login", ip, "USER@example.test");
    }
    expect((await authAttemptGuard("login", ip, "user@example.test")).ok).toBe(false);
    expect((await authAttemptGuard("login", ip, "someoneelse@example.test")).ok).toBe(true);
  });
});

describe("identity helpers", () => {
  it("takes the first X-Forwarded-For entry and falls back to x-real-ip then unknown", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }))).toBe("198.51.100.7");
    expect(clientIpFrom(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });

  it("never puts raw emails or IPs into storage keys (hash-only identities)", () => {
    const first = hashIdentity("parent@example.test");
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toContain("parent");
  });
});

describe("the Upstash REST backend (durable store leg)", () => {
  const calls: Array<{ url: string; body?: string }> = [];

  beforeEach(() => {
    calls.length = 0;
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    _resetRateLimitForTests();
  });

  it("is selected when the env is wired and executes the counter through the REST API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        calls.push({ url: String(input), body: init?.body as string | undefined });
        return new Response(JSON.stringify([...Array(3)].map((_, i) => ({ result: i + 1 }))), {
          status: 200,
        });
      }) as unknown as typeof fetch
    );
    try {
      expect(rateLimitBackend()).toBe("upstash");
      const allowed = await throttle("up", { limit: 2, windowSec: 60 }, "net-caller");
      expect(allowed.ok).toBe(true);
      const refused = await throttle("up", { limit: 2, windowSec: 60 }, "net-caller");
      expect(refused.ok).toBe(true); // second allowed (count 2 <= limit)
      await throttle("up2", { limit: 0, windowSec: 60 }, "net-caller");
      const expectedBlocked = await throttle("up3", { limit: 0, windowSec: 60 }, "net-caller");
      expect(expectedBlocked.ok).toBe(false);
      expect(calls[0].body).toContain('"INCR"');
      expect(calls[0].url).toBe("https://redis.example/pipeline");
      expect(calls[0].body).toContain("EXPIRE");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails OPEN (with a loud log) when the durable store is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const decision = await throttle("outage", { limit: 1, windowSec: 60 }, "caller");
      expect(decision.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
