// KID-57: account language persistence. Verifies the language column defaults
// to en, that setAccountLanguage persists ar, and that getAccount answers the
// new language so the app reacts on the next render.

import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, getAccount, setAccountLanguage } from "@/lib/auth";
import { seedFixture, mustGet } from "../helpers";

beforeEach(async () => {
  await seedFixture();
});

describe("account language persistence", () => {
  it("defaults to en on signup", async () => {
    const acc = await createAccount({ email: "lang@test", password: "x", fullName: "Lang Tester", role: "parent" });
    const row = await mustGet("SELECT language FROM account WHERE id = ?", acc!.id);
    expect(String(row.language)).toBe("en");
  });

  it("persists ar via setAccountLanguage", async () => {
    const acc = await createAccount({ email: "lang2@test", password: "x", fullName: "Lang Tester", role: "parent" });
    await setAccountLanguage(String(acc!.id), "ar");
    const after = await getAccount(String(acc!.id));
    expect(after?.language).toBe("ar");
  });

  it("persists switching back to en", async () => {
    const acc = await createAccount({ email: "lang3@test", password: "x", fullName: "Lang Tester", role: "parent" });
    await setAccountLanguage(String(acc!.id), "ar");
    await setAccountLanguage(String(acc!.id), "en");
    const after = await getAccount(String(acc!.id));
    expect(after?.language).toBe("en");
  });
});