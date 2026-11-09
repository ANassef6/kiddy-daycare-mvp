// KID-1175/F-04: the session signing secret must fail closed in production.
// Before this fix, `lib/auth.ts` fell back to the publicly-known
// "dev-only-secret-change-me" constant (or the empty string, KID-686) when
// SESSION_SECRET was missing/unset in production, logged one warning, and
// kept running — issuing forgeable HMAC-SHA256 30-day session tokens.
//
// Pins:
//   1. a production boot without SESSION_SECRET refuses (import throws),
//   2. an empty / whitespace-only value refuses,
//   3. the known dev default refuses,
//   4. a too-short (< 32 chars) value refuses, and the failure message never
//      echoes the configured value (the secret must never be logged),
//   5. a strong secret boots and sessions round-trip,
//   6. tokens signed with one configured secret verify ONLY with that
//      secret — a differently-configured process refuses them,
//   7. dev/test keep working with the local fallback (no throw).

process.env.TZ = "UTC";

import { afterEach, describe, expect, it, vi } from "vitest";

const STRONG_A = "kid1175-strong-secret-aaaabbbbccccddddeeeeffff00001111";
const STRONG_B = "kid1175-strong-secret-111122223333444455556666aaaabbbb";
const TOO_SHORT = "kid1175-short";

const savedNodeEnv = process.env.NODE_ENV;
const savedSecret = process.env.SESSION_SECRET;

function setEnv(nodeEnv: string | null, secret: string | null): void {
  if (nodeEnv === null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  if (secret === null) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = secret;
}

afterEach(() => {
  setEnv(savedNodeEnv ?? null, savedSecret ?? null);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KID-1175/F-04 production boots fail closed without a valid SESSION_SECRET", () => {
  it("a missing secret refuses to boot", async () => {
    setEnv("production", null);
    await expect(import("@/lib/auth")).rejects.toThrow(/SESSION_SECRET/);
  });

  it("an empty string is not an escape hatch (KID-686 regression)", async () => {
    setEnv("production", "");
    await expect(import("@/lib/auth")).rejects.toThrow(/missing or empty/);
  });

  it("a whitespace-only value is treated as missing", async () => {
    setEnv("production", "   ");
    await expect(import("@/lib/auth")).rejects.toThrow(/missing or empty/);
  });

  it("the publicly-known dev default refuses to boot", async () => {
    setEnv("production", "dev-only-secret-change-me");
    await expect(import("@/lib/auth")).rejects.toThrow(/dev constant/);
  });

  it("a too-short secret refuses to boot and the error never echoes the value", async () => {
    setEnv("production", TOO_SHORT);
    let thrown: unknown;
    try {
      await import("@/lib/auth");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/SESSION_SECRET/);
    expect(message).not.toContain(TOO_SHORT);
  });

  it("a strong secret boots and sessions round-trip through the auth surface", async () => {
    setEnv("production", STRONG_A);
    const auth = await import("@/lib/auth");
    const token = auth.createSessionToken({
      accountId: "acc-1175",
      role: "parent",
      email: "kid1175@example.test",
      emailConfirmed: true,
    });
    const fromCookie = auth.readSessionFromCookie(`kiddy_sess=${token}`);
    expect(fromCookie).toMatchObject({ accountId: "acc-1175", email: "kid1175@example.test" });
    expect(fromCookie?.emailConfirmed).toBe(true);
  });

  it("sessions verify ONLY with the configured secret - a differently-configured process refuses them", async () => {
    setEnv("production", STRONG_A);
    const authA = await import("@/lib/auth");
    const token = authA.createSessionToken({
      accountId: "acc-1175b",
      role: "admin",
      email: "swap@example.test",
      emailConfirmed: true,
    });

    // Fresh module resolution with a different (equally valid) secret makes
    // the first process's tokens unreadable — exactly how a suspected
    // compromise forces the one-time global logout.
    vi.resetModules();
    setEnv("production", STRONG_B);
    const authB = await import("@/lib/auth");
    expect(authB.verifyToken(token)).toBeNull();
    expect(authB.readSessionFromCookie(`kiddy_sess=${token}`)).toBeNull();

    const reborn = authB.createSessionToken({
      accountId: "acc-1175b",
      role: "admin",
      email: "swap@example.test",
      emailConfirmed: true,
    });
    expect(authB.readSessionFromCookie(`kiddy_sess=${reborn}`)?.accountId).toBe("acc-1175b");
  });
});

describe("KID-1175/F-04 dev/test keep the local fallback", () => {
  it("outside production a missing secret still boots (local http dev keeps working)", async () => {
    setEnv("test", null);
    const auth = await import("@/lib/auth");
    const token = auth.createSessionToken({
      accountId: "acc-dev",
      role: "parent",
      email: "dev@example.test",
      emailConfirmed: true,
    });
    expect(auth.readSessionFromCookie(`kiddy_sess=${token}`)?.accountId).toBe("acc-dev");
  });

  it("outside production an explicit secret is honored", async () => {
    setEnv("test", STRONG_A);
    const auth = await import("@/lib/auth");
    const token = auth.createSessionToken({
      accountId: "acc-dev2",
      role: "parent",
      email: "dev2@example.test",
      emailConfirmed: true,
    });
    expect(auth.readSessionFromCookie(`kiddy_sess=${token}`)?.accountId).toBe("acc-dev2");
  });
});
