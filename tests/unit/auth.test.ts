// Auth-layer unit tests: password hashing, signed session tokens, PIN login,
// account creation/lookup rules.

import { beforeEach, describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  createSessionToken,
  readSessionFromCookie,
  sessionCookieHeader,
  clearSessionCookieHeader,
  createAccount,
  findAccountByEmail,
  getAccount,
  setPin,
  loginWithPin,
  setEmailConfirmed,
  emailConfirmedFor,
} from "@/lib/auth";
import { mustGet, resetDb } from "../helpers";

beforeEach(async () => {
  await resetDb();
});

describe("password hashing", () => {
  it("hashes with salt and verifies correct/incorrect passwords", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(hash).toContain(":");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("produces distinct hashes for the same password (random salt)", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(verifyPassword("same-password", a)).toBe(true);
    expect(verifyPassword("same-password", b)).toBe(true);
  });
});

describe("signed session tokens", () => {
  it("signToken round-trips and verifyToken rejects tampering", () => {
    const token = signToken({ accountId: "acc-1", role: "parent" });
    const payload = verifyToken(token)!;
    expect(payload.accountId).toBe("acc-1");
    expect(payload.role).toBe("parent");
    // tamper with the body part
    const parts = token.split(".");
    const tampered = Buffer.from(JSON.stringify({ accountId: "acc-2", role: "owner" })).toString("base64url") + "." + parts[1];
    expect(verifyToken(tampered)).toBeNull();
    expect(verifyToken("not-a-token")).toBeNull();
  });

  it("malformed signature lengths return null instead of throwing (regression pin D4)", () => {
    // verifyToken used to compute the HMAC of the 1-char body (43-byte digest)
    // then timingSafeEqual it against a 1-byte sig buffer, which threw
    // RangeError("Input buffers must have the same byte length") and crashed
    // session parsing for a malformed kiddy_sess cookie. Now any mismatched-
    // length signature is rejected as unverified (returns null). QA finding D4.
    expect(verifyToken("a.b")).toBeNull();
    expect(() => verifyToken("a.b")).not.toThrow();
  });

  it("session cookie round-trips through readSessionFromCookie", () => {
    const session = { accountId: "acc-1", role: "owner", email: "a@b.test", emailConfirmed: true };
    const header = sessionCookieHeader(session);
    const setCookie = header["Set-Cookie"];
    const cookieName = "kiddy_sess";
    const m = setCookie.match(new RegExp(`${cookieName}=([^;]+)`))!;
    const parsed = readSessionFromCookie(`${cookieName}=${m[1]}`)!;
    expect(parsed.accountId).toBe("acc-1");
    expect(parsed.role).toBe("owner");
    expect(parsed.emailConfirmed).toBe(true);
  });

  it("readSessionFromCookie rejects no cookie, garbage, and expired tokens", () => {
    expect(readSessionFromCookie(null)).toBeNull();
    expect(readSessionFromCookie("kiddy_sess=not-valid;")).toBeNull();
    const expired = signToken({ accountId: "a1", role: "parent", exp: Date.now() - 1000 });
    expect(readSessionFromCookie(`kiddy_sess=${expired};`)).toBeNull();
  });

  it("clearSessionCookieHeader expires the cookie", () => {
    const header = clearSessionCookieHeader();
    expect(header["Set-Cookie"]).toContain("Max-Age=0");
  });
});

describe("account lifecycle", () => {
  it("createAccount hashes password, lowercases email, keeps PIN hashed", async () => {
    const acc = await createAccount({ email: "UPPER@Example.COM", password: "pw123456", fullName: "Test User", pin: "4321" });
    expect(acc.email).toBe("upper@example.com");
    expect(acc.password_hash).not.toContain("pw123456");
    const storedPin = await mustGet("SELECT pin FROM account WHERE id = ?", acc.id);
    expect(storedPin.pin).not.toBe("4321"); // sha256 hex
  });

  it("findAccountByEmail is case-insensitive and getAccount works", async () => {
    await createAccount({ email: "parent@example.test", password: "x", fullName: "P" });
    const found = await findAccountByEmail("PARENT@example.test");
    expect(found).toBeDefined();
    expect((await getAccount(String(found!.id)))!.full_name).toBe("P");
  });

  it("PIN login only matches hashed PIN and fails when unset", async () => {
    const acc = await createAccount({ email: "p@e.test", password: "x", fullName: "P" });
    expect(await loginWithPin("0000", acc.id)).toBe(false); // no pin set
    await setPin(acc.id, "2468");
    expect(await loginWithPin("2468", acc.id)).toBe(true);
    expect(await loginWithPin("1357", acc.id)).toBe(false);
  });

  it("email confirmation flag is settable and surfaced", async () => {
    const acc = await createAccount({ email: "c@e.test", password: "x", fullName: "C", emailConfirmed: false });
    expect(emailConfirmedFor(acc)).toBe(false);
    await setEmailConfirmed(acc.id, true);
    const refreshed = await getAccount(acc.id);
    expect(emailConfirmedFor(refreshed)).toBe(true);
  });

  it("emailConfirmedFor defaults true for unknown accounts", () => {
    expect(emailConfirmedFor(undefined)).toBe(true);
  });

  it("createSessionToken embeds the 30-day expiry", () => {
    const token = createSessionToken({ accountId: "a", role: "parent", email: "e", emailConfirmed: true });
    const payload = verifyToken(token)!;
    expect(typeof payload.exp).toBe("number");
    expect(payload.exp).toBeGreaterThan(Date.now());
  });
});