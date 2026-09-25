// KID-119: unit tests for publicOrigin() — parent-facing mail links must use
// the deployed host, never the sender's localhost.
import { describe, expect, it, afterEach } from "vitest";
import { publicOrigin } from "@/lib/url";

const SAVED = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (SAVED === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED;
});

describe("publicOrigin", () => {
  it("prefers NEXT_PUBLIC_SITE_URL over the request fallback", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://kiddy.example.com";
    expect(publicOrigin("http://localhost:3000")).toBe("https://kiddy.example.com");
  });

  it("trims trailing slashes from the configured URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://kiddy.example.com///";
    expect(publicOrigin("http://localhost:3000")).toBe("https://kiddy.example.com");
  });

  it("falls back to the passed origin when the env is unset", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(publicOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(publicOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("returns empty outside a request scope when nothing is configured", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(publicOrigin()).toBe("");
  });
});
