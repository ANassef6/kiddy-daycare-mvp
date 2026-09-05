// White-label theming unit tests: branding config -> CSS custom-property theme.
// The brand swap (name/logo/colors/font) must be pure config, not code.

import { beforeEach, describe, expect, it } from "vitest";
import * as theme from "@/lib/theme";
import * as store from "@/lib/store";
import { mustGet, seedFixture } from "../helpers";

beforeEach(async () => {
  await seedFixture();
});

const seeded = () => mustGet("SELECT id, name, primary_color, accent_color, font FROM institute LIMIT 1");

describe("brandingFromInstitute", () => {
  it("maps the institute row into branding (defaults for missing values)", () => {
    const b = theme.brandingFromInstitute({});
    expect(b.name).toBe("Kiddy");
    expect(b.primaryColor).toBe("#3B82F6");
    expect(b.accentColor).toBe("#10B981");
    expect(b.font).toBe("Inter");
    expect(b.logoUrl).toBeNull();
  });

  it("reads seeded branding values", async () => {
    const row = await seeded();
    const b = theme.brandingFromInstitute(row);
    expect(b.name).toBe("Sunshine Daycare");
    expect(b.primaryColor).toBe("#8B5CF6");
    expect(b.accentColor).toBe("#F59E0B");
    expect(b.font).toBe("Nunito");
  });
});

describe("themeCss", () => {
  it("emits all three CSS custom properties", () => {
    const css = theme.themeCss({
      name: "X",
      logoUrl: null,
      brandImageUrl: null,
      primaryColor: "#E11D48",
      accentColor: "#0D9488",
      font: "Poppins",
    });
    expect(css).toContain("--brand-primary: #E11D48;");
    expect(css).toContain("--brand-accent: #0D9488;");
    expect(css).toContain("--brand-font: 'Poppins', system-ui, sans-serif;");
  });
});

describe("white-label swap end-to-end (config, not code)", () => {
  it("swap name + colors + font and getFirstInstitute reflects the change", async () => {
    const inst = await seeded();
    await store.updateInstitute(String(inst.id), {
      name: "Rainbow Ridge Childcare",
      primary_color: "#1E3A8A",
      accent_color: "#F59E0B",
      font: "Poppins",
    });
    const first = await theme.getFirstInstitute();
    const b = theme.brandingFromInstitute(first);
    expect(b.name).toBe("Rainbow Ridge Childcare");
    expect(b.primaryColor).toBe("#1E3A8A");
    expect(b.accentColor).toBe("#F59E0B");
    expect(b.font).toBe("Poppins");
    const css = theme.themeCss(b);
    expect(css).toContain("--brand-primary: #1E3A8A;");
  });
});