// KID-369: regression coverage for the KID-257 live-audit cleanup batch.
//   DEF-003 — /child/drive duplicated institute-wide files once per linked
//             child (same React key twice). Fixed by deduping the merged
//             per-child drive lists by file id (lib/helpers dedupeById).
//   DEF-005 — SQLite contact flags are numeric 0/1; `{c.is_pickup && <span/>}`
//             rendered the falsy 0 as a literal "0" next to the badges.
//             Fixed in components/ContactBadges.
//   OBS-001 — a stale kiddy_lang device cookie flipped the root-layout dir
//             against the account.dictionary locale. Fixed by effectiveLocale:
//             account.language wins for signed-in users, cookie only for the
//             anonymous/legacy case.
//   OBS-002 — sign-out (98x34) and burger (40x40) hit areas below 44px at
//             320-430px. Fixed in globals.css inside the ≤720px breakpoint so
//             the KID-255 pinned-sign-out desktop layout is untouched.

import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";

import { dedupeById } from "@/lib/helpers";
import ContactBadges from "@/components/ContactBadges";
import { effectiveLocale } from "@/lib/i18n-session";
import { en, ar } from "@/lib/i18n";
import * as store from "@/lib/store";
import { queryGet } from "@/lib/db";
import { createSessionToken, readSessionFromCookieValue } from "@/lib/auth";
import { seedFixture } from "../helpers";

beforeEach(async () => {
  await seedFixture();
});

describe("DEF-003: drive lists dedupe institute-wide files by id", () => {
  it("dedupeById keeps the first occurrence and the original order", () => {
    const rows = [
      { id: "b", filename: "second" },
      { id: "a", filename: "first" },
      { id: "b", filename: "dupe" },
      { id: "a", filename: "first-dupe" },
    ];
    expect(dedupeById(rows)).toEqual([
      { id: "b", filename: "second" },
      { id: "a", filename: "first" },
    ]);
  });

  it("deduplicates empty rows gracefully", () => {
    expect(dedupeById([])).toEqual([]);
  });

  it("merged per-child drive lists keep the shared handbook exactly once", async () => {
    const parent = await queryGet("SELECT * FROM account WHERE email = ?", "parent@example.test");
    if (parent === undefined) throw new Error("seeded parent@example.test missing");
    const families = await store.familiesForAccount(String(parent.id));
    expect(families.length).toBe(2);
    const instituteId = String(families[0].institute_id);

    // The exact production shape: child_id NULL (institute-wide) + real
    // per-child files for both children.
    await store.addDriveFile({ instituteId, filename: "Handbook.pdf", url: "https://files.test/handbook" });
    await store.addDriveFile({ instituteId, filename: "Amira art.pdf", url: "https://files.test/amira", childId: String(families[0].id) });
    await store.addDriveFile({ instituteId, filename: "Kareem art.pdf", url: "https://files.test/kareem", childId: String(families[1].id) });

    // The page's merge strategy: per-child lists flat-mapped, then deduped.
    const raw = (
      await Promise.all(families.map((c: Record<string, unknown>) =>
        store.driveFilesFor(String(c.institute_id), String(c.id))
      ))
    ).flatMap((f: Record<string, unknown>[]) => f);
    // The pre-fix defect: the institute-wide row appears once per child.
    const rawHandbook = raw.filter((f: Record<string, unknown>) => f.filename === "Handbook.pdf").length;
    expect(rawHandbook).toBe(families.length);

    const files = dedupeById(raw);
    expect(files.filter((f: Record<string, unknown>) => f.filename === "Handbook.pdf")).toHaveLength(1);
    expect(files.filter((f: Record<string, unknown>) => f.filename === "Amira art.pdf")).toHaveLength(1);
    expect(files.filter((f: Record<string, unknown>) => f.filename === "Kareem art.pdf")).toHaveLength(1);
    // And the deduped ids are unique — no React key collision is possible.
    expect(new Set(files.map((f: Record<string, unknown>) => String(f.id))).size).toBe(files.length);
  });
});

describe("DEF-005: contact badges never render SQLite 0 as text", () => {
  const badgeLabels = (markup: string) => ({
    pickup: markup.includes(">Pickup<"),
    emergency: markup.includes(">Emergency<"),
  });

  it("numeric 0 flags render no badge and no stray '0'", () => {
    const markup = renderToStaticMarkup(
      <ContactBadges isPickup={0} isEmergency={0} dict={en} />
    );
    expect(markup).not.toContain("Pickup");
    expect(markup).not.toContain("Emergency");
    expect(markup).not.toContain("0");
  });

  it("numeric 1 flags render the badges exactly like the old truthy path", () => {
    const both = renderToStaticMarkup(<ContactBadges isPickup={1} isEmergency={1} dict={en} />);
    const labelsBoth = badgeLabels(both);
    expect(labelsBoth.pickup).toBe(true);
    expect(labelsBoth.emergency).toBe(true);
    expect(both).toContain("badge badge-red");

    const pickupOnly = renderToStaticMarkup(<ContactBadges isPickup={1} isEmergency={0} dict={en} />);
    expect(badgeLabels(pickupOnly)).toEqual({ pickup: true, emergency: false });
    expect(pickupOnly).not.toContain("0");
  });

  it("keeps the AR labels working through the dict", () => {
    const markup = renderToStaticMarkup(<ContactBadges isPickup={1} isEmergency={1} dict={ar} />);
    expect(markup).toContain("استلام");
  });
});

describe("OBS-001: effectiveLocale reconciles cookie vs account.language", () => {
  // The defect: cookie `kiddy_lang=ar` left on a device after the account
  // language changed to EN elsewhere → dir=rtl layout, English dictionaries.
  it("stale cookie (ar) loses to account.language=en", () => {
    expect(effectiveLocale("ar", "en")).toBe("en");
  });

  it("stale cookie (en) loses to account.language=ar", () => {
    expect(effectiveLocale("en", "ar")).toBe("ar");
  });

  it("aligned cookie + account agree on ar", () => {
    expect(effectiveLocale("ar", "ar")).toBe("ar");
  });

  it("anonymous (no account language): the device cookie decides", () => {
    expect(effectiveLocale("ar", null)).toBe("ar");
    expect(effectiveLocale(null, null)).toBe("en");
  });

  it("signed-in legacy rows without a language fall back to the cookie", () => {
    expect(effectiveLocale("ar", undefined)).toBe("ar");
  });

  it("an unknown cookie value never decides", () => {
    expect(effectiveLocale("de", null)).toBe("en");
    expect(effectiveLocale("de", "ar")).toBe("ar");
  });
});

describe("OBS-002: header hit areas >= 44px inside the ≤720px breakpoint", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
  // The media-query burger block is the LAST .child-nav-burger rule; the
  // desktop one (display: none) comes earlier.
  const burgerCss = css.slice(
    css.lastIndexOf(".child-nav-burger {"),
    css.lastIndexOf(".child-nav-burger:hover")
  );

  it("the burger is inside the ≤720px breakpoint and sized 44x44 (not 40x40)", () => {
    const burgerStart = css.lastIndexOf(".child-nav-burger {");
    const owningMediaQuery = css.lastIndexOf("@media (max-width: 720px)", burgerStart);
    expect(owningMediaQuery).toBeGreaterThan(-1);
    expect(owningMediaQuery).toBeLessThan(burgerStart);
    expect(burgerCss).toContain("width: 44px");
    expect(burgerCss).toContain("height: 44px");
    expect(burgerCss).not.toContain("40px");
  });

  it("the pinned sign-out button stretches to a 44px hit height", () => {
    expect(css).toContain(".child-nav form .btn");
    expect(css).toContain("min-height: 44px");
  });

  it("the kid255 sign-out contract is still intact (button stays pinned outside the nav)", () => {
    const markup = fs.readFileSync(path.join(process.cwd(), "components", "ChildNavMenu.tsx"), "utf8");
    expect(markup).toContain('formAction="/api/logout"');
    expect(markup.indexOf("child-nav-inline")).toBeLessThan(markup.indexOf('formAction="/api/logout"'));
  });

  it("the session token round trip still parses the way the layout reads it", () => {
    // readSessionFromCookieValue takes the bare cookie value (not the pair).
    const token = createSessionToken({ accountId: "acc-369", role: "parent", email: "p@t", emailConfirmed: true });
    const session = readSessionFromCookieValue(encodeURIComponent(token));
    expect(session?.accountId).toBe("acc-369");
  });
});
