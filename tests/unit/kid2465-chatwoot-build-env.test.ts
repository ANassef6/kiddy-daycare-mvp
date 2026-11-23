// KID-2465: the production Worker build shipped without the Chatwoot website
// token even though the base URL was present, so the widget rendered nothing.
// NEXT_PUBLIC_* values are inlined at build time, which makes a half-configured
// env a silent, permanent outage. Pin the fail-fast guard in next.config.mjs.

import { afterEach, describe, expect, it, vi } from "vitest";
import { assertChatwootBuildEnv } from "../../next.config.mjs";

const BASE_URL = "https://chatwoot.kiddyapp.net";
const TOKEN = "test-website-token-0000";
const production = { NODE_ENV: "production" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KID-2465 Chatwoot build environment guard", () => {
  it("accepts both values unset (the supported Chatwoot-off state)", () => {
    expect(() => assertChatwootBuildEnv({ ...production })).not.toThrow();
    expect(() =>
      assertChatwootBuildEnv({
        ...production,
        NEXT_PUBLIC_CHATWOOT_BASE_URL: "  ",
        NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN: "",
      }),
    ).not.toThrow();
  });

  it("accepts both values set", () => {
    expect(() =>
      assertChatwootBuildEnv({
        ...production,
        NEXT_PUBLIC_CHATWOOT_BASE_URL: BASE_URL,
        NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN: TOKEN,
      }),
    ).not.toThrow();
  });

  it("rejects a base URL without a website token in a production build", () => {
    expect(() =>
      assertChatwootBuildEnv({
        ...production,
        NEXT_PUBLIC_CHATWOOT_BASE_URL: BASE_URL,
      }),
    ).toThrow(/NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN is empty/);
  });

  it("rejects a website token without a base URL in a production build", () => {
    expect(() =>
      assertChatwootBuildEnv({
        ...production,
        NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN: TOKEN,
      }),
    ).toThrow(/NEXT_PUBLIC_CHATWOOT_BASE_URL is empty/);
  });

  it("only warns outside production builds", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertChatwootBuildEnv({
        NODE_ENV: "development",
        NEXT_PUBLIC_CHATWOOT_BASE_URL: BASE_URL,
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not echo either configured value in the failure message", () => {
    let message = "";
    try {
      assertChatwootBuildEnv({
        ...production,
        NEXT_PUBLIC_CHATWOOT_BASE_URL: BASE_URL,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("KID-2465");
    expect(message).not.toContain(BASE_URL);
  });
});
