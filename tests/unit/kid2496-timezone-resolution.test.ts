// KID-2496: the display helpers are only useful when the pages receive the
// CENTER's zone. i18nForAccount is the single resolution point every
// portal/child page already calls, so this suite proves it returns the
// seeded institute's IANA timezone (and follows a change to it).

import { beforeAll, describe, expect, it } from "vitest";
import { queryGet, queryRun } from "@/lib/db";
import { i18nForAccount } from "@/lib/i18n-session";
import { resetDb } from "../helpers";
import { seedDemo } from "@/lib/seed";

const CAIRO = "Africa/Cairo";
const NEW_YORK = "America/New_York";

beforeAll(async () => {
  await resetDb();
  await seedDemo();
});

describe("KID-2496 i18nForAccount center clock", () => {
  it("returns the seeded center timezone with the locale context", async () => {
    const account = await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1");
    const ctx = await i18nForAccount(String(account!.id));
    expect(ctx.timeZone).toBe(CAIRO);
    expect(ctx.locale).toBe("en");
  });

  it("follows the center's configured zone instead of hard-coding Cairo", async () => {
    const inst = await queryGet("SELECT id FROM institute LIMIT 1");
    await queryRun("UPDATE institute SET timezone = ? WHERE id = ?", NEW_YORK, String(inst!.id));
    const account = await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1");
    const ctx = await i18nForAccount(String(account!.id));
    expect(ctx.timeZone).toBe(NEW_YORK);
    await queryRun("UPDATE institute SET timezone = ? WHERE id = ?", CAIRO, String(inst!.id));
  });
});
