// KID-214: the root layout's account-language fallback was dead. layout.tsx
// passed the bare `kiddy_sess` cookie value (from Next's cookies() store) into
// readSessionFromCookie, which expects a full `Cookie:` header string matching
// on `kiddy_sess=` — so it always returned null and an account with
// language=ar but no kiddy_lang cookie rendered under <html dir="ltr">.

import { beforeAll, describe, expect, it } from "vitest";
import {
  createAccount,
  createSessionToken,
  getAccount,
  readSessionFromCookie,
  readSessionFromCookieValue,
  setAccountLanguage,
  type Session,
} from "@/lib/auth";
import { dirFor, localeOf } from "@/lib/i18n";
import { seedFixture } from "../helpers";

let session: Session;
let token: string;

beforeAll(async () => {
  await seedFixture();
  const acc = await createAccount({
    email: "kid214@test",
    password: "x",
    fullName: "Cookie Fallback Tester",
    role: "parent",
  });
  await setAccountLanguage(String(acc!.id), "ar");
  const fresh = await getAccount(String(acc!.id));
  session = {
    accountId: String(acc!.id),
    role: "parent",
    email: "kid214@test",
    emailConfirmed: true,
  };
  token = createSessionToken(session);
  expect(fresh?.language).toBe("ar");
});

describe("KID-214 root layout language fallback", () => {
  it("regression: the bare cookie value never parsed under the header reader", () => {
    // This is what layout.tsx did before the fix — always null.
    expect(readSessionFromCookie(token)).toBeNull();
  });

  it("value-only reader resolves the session from the bare cookie value", () => {
    expect(readSessionFromCookieValue(token)).toMatchObject({
      accountId: session.accountId,
      role: "parent",
      email: session.email,
    });
  });

  it("value-only reader still returns null for missing/empty values", () => {
    expect(readSessionFromCookieValue(null)).toBeNull();
    expect(readSessionFromCookieValue(undefined)).toBeNull();
    expect(readSessionFromCookieValue("")).toBeNull();
  });

  it("header reader still parses a full Cookie: header (existing behavior)", () => {
    expect(readSessionFromCookie(`other=1; kiddy_sess=${token}`)).toMatchObject({
      accountId: session.accountId,
    });
  });

  it("session reader rejects a tampered token", () => {
    expect(readSessionFromCookieValue(`${token}x`)).toBeNull();
  });

  it("account language=ar resolves to rtl when read through the fallback chain", async () => {
    const parsed = readSessionFromCookieValue(token);
    expect(parsed).not.toBeNull();
    const account = await getAccount(parsed!.accountId);
    const locale = localeOf(account?.language);
    // No kiddy_lang cookie on the request — the account preference alone must
    // drive <html lang="ar" dir="rtl">.
    expect(locale).toBe("ar");
    expect(dirFor(locale)).toBe("rtl");
  });
});
