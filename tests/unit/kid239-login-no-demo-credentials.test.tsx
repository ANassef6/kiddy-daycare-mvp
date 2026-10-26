// KID-239: The demo-credentials hint on the login page shipped to production.
// This file pins its REMOVAL: /login must render with zero occurrences of any
// demo credential string, on every render path, pre-launch and after.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import LoginPage from "@/app/login/page";

const FORBIDDEN = [
  "Demo:",
  "admin@sunshinedaycare.test",
  "parent@example.test",
  "kiddy-admin",
  "kiddy-parent",
];

describe("KID-239: login page contains no demo credentials", () => {
  it("renders no credential material on the login page", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    for (const s of FORBIDDEN) expect(html).not.toContain(s);
    // The register path stays intact
    expect(html).toContain("/register");
  });

  it("the login page source no longer contains the hardcoded hint", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "app", "login", "page.tsx"),
      "utf8",
    );
    for (const s of FORBIDDEN) expect(src).not.toContain(s);
  });
});
