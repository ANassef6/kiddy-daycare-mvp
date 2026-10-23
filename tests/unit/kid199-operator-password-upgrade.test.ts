// KID-199.6: the platform operator row must ADOPT an explicitly configured
// PLATFORM_OPERATOR_PASSWORD. KID-216 minted the production operator with a
// random secret; after the board specified a new value, re-running the
// bootstrap pass has to upgrade the existing account's password hash —
// otherwise the board-specified credentials are sold but never usable.
//
// The KID-199.4r rail stays hard: when PLATFORM_OPERATOR_PASSWORD is not set
// the bootstrap never touches an existing operator row's password (the demo
// default is never pushed onto a server this code does not own), and the
// requireEnv allowlist gate still decides whether the bootstrap runs at all.

import { describe, expect, it, vi } from "vitest";
import { findAccountByEmail, verifyPassword } from "@/lib/auth";
import { seedFixture } from "../helpers";

const DEMO_PASSWORD = "kiddy-superadmin";
const DEMO_EMAIL = "superadmin@kiddy.test";

async function runOperatorBootstrap(): Promise<void> {
  const { ensurePlatformOperator } = await import("@/lib/seed");
  await ensurePlatformOperator();
}

describe("KID-199.6 password-upgrade-on-env-change", () => {
  it("an existing operator row adopts the configured PLATFORM_OPERATOR_PASSWORD", async () => {
    await seedFixture();
    vi.stubEnv("PLATFORM_ADMIN_EMAIL", DEMO_EMAIL);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD", "board-set-one-time-777");
    try {
      await runOperatorBootstrap();
      const row = await findAccountByEmail(DEMO_EMAIL);
      expect(row).toBeDefined();
      expect(String(row!.role)).toBe("platform");
      expect(verifyPassword("board-set-one-time-777", String(row!.password_hash))).toBe(true);
      expect(verifyPassword(DEMO_PASSWORD, String(row!.password_hash))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a second env change re-upgrades the row; the old configured value stops working", async () => {
    await seedFixture();
    vi.stubEnv("PLATFORM_ADMIN_EMAIL", DEMO_EMAIL);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD", "rotation-step-one");
    try {
      await runOperatorBootstrap();
      let row = await findAccountByEmail(DEMO_EMAIL);
      const firstHash = String(row!.password_hash);
      expect(verifyPassword("rotation-step-one", firstHash)).toBe(true);

      vi.stubEnv("PLATFORM_OPERATOR_PASSWORD", "rotation-step-two-9999");
      await runOperatorBootstrap();
      row = await findAccountByEmail(DEMO_EMAIL);
      const secondHash = String(row!.password_hash);
      expect(secondHash).not.toBe(firstHash);
      expect(verifyPassword("rotation-step-two-9999", secondHash)).toBe(true);
      expect(verifyPassword("rotation-step-one", secondHash)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("re-running the bootstrap with the same env value is a no-op (no hash churn)", async () => {
    await seedFixture();
    vi.stubEnv("PLATFORM_ADMIN_EMAIL", DEMO_EMAIL);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD", "stable-configured-value");
    try {
      await runOperatorBootstrap();
      const before = await findAccountByEmail(DEMO_EMAIL);
      const hashBefore = String(before!.password_hash);
      await runOperatorBootstrap();
      const after = await findAccountByEmail(DEMO_EMAIL);
      expect(String(after!.password_hash)).toBe(hashBefore);
      expect(verifyPassword("stable-configured-value", String(after!.password_hash))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rail preserved: with PLATFORM_OPERATOR_PASSWORD unset, the demo default is never pushed onto an existing row", async () => {
    await seedFixture();
    const before = await findAccountByEmail(DEMO_EMAIL);
    const originalHash = String(before!.password_hash);
    vi.stubEnv("PLATFORM_ADMIN_EMAIL", DEMO_EMAIL);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD", "");
    try {
      await runOperatorBootstrap();
      const after = await findAccountByEmail(DEMO_EMAIL);
      expect(String(after!.password_hash)).toBe(originalHash);
      expect(verifyPassword(DEMO_PASSWORD, String(after!.password_hash))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rail preserved: requireEnv bootstrap still skips entirely when no allowlist env is set", async () => {
    await seedFixture();
    const before = await findAccountByEmail(DEMO_EMAIL);
    const originalHash = String(before!.password_hash);
    vi.stubEnv("PLATFORM_ADMIN_EMAIL", "");
    vi.stubEnv("SUPERADMIN_EMAIL", "");
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD", "should-never-land");
    try {
      const { ensurePlatformOperator } = await import("@/lib/seed");
      await ensurePlatformOperator({ requireEnv: true });
      const after = await findAccountByEmail(DEMO_EMAIL);
      expect(String(after!.password_hash)).toBe(originalHash);
      expect(verifyPassword("should-never-land", String(after!.password_hash))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
