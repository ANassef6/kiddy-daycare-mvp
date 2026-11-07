// KID-489 item 7: the Enhancements requests page's Vikunja link surface is
// superadmin-only, and the table header renders inline (no stacked `.label`
// th cells).
//
// Pinned here:
//   1. A center owner still gets the full page (form + request list), but the
//      request table carries NO Vikunja column at all — neither the "Vikunja"
//      header nor the "Open in Vikunja" link ever appears in the owner's DOM,
//      even for rows that DO hold a Vikunja task URL.
//   2. The platform superadmin (platform sentinel role AND an allowlisted
//      email — the same double gate as every /platform surface) gets the
//      link column with the "Open in Vikunja" link to the stored task URL.
//   3. A sentinel-role session with a NON-allowlisted email is still refused
//      (redirect to /portal/dashboard) — role alone is never enough.
//   4. The header cells use the `.table-label` class and never `.label`
//      (whose `display: block` stacked every header cell vertically on
//      desktop, the reported bug); the class keeps label styling without
//      breaking table-cell layout.
//   5. The EN + AR label reads "Open in Vikunja" / "افتح في Vikunja" (still
//      "Open in Linear" would fail this suite).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyLinearWriteBack, createEnhancementRequest } from "@/lib/enhancements";
import { createSessionToken, type Session } from "@/lib/auth";
import { dictionaries, keysOf } from "@/lib/i18n";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

// The page + tenant resolver read the request head through next/headers; the
// suite injects the cookie and host per test (kid264 / kid236 harness).
const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    if (mockState.host) entries.host = mockState.host;
    return new Headers(entries);
  },
  cookies: () => ({ get: () => undefined, set: () => undefined }),
}));

// A tenant host that resolves through the REAL host→tenant rule, like prod:
// set the apex, give Sunshine its subdomain, point the request at it.
const APEX = "kiddy-test.example";
const SUNSHINE_SUBDOMAIN = "sunshine";

function sessionCookieFor(accountId: string, role: string, email: string): string {
  const session: Session = { accountId, role, email, emailConfirmed: true };
  return `kiddy_sess=${createSessionToken(session)}`;
}

let sunshineIid: string;
let sunshineName: string;
let ownerId: string;
let ownerEmail: string;
let operatorId: string;
const OPERATOR_EMAIL = "superadmin@kiddy.test";

beforeEach(async () => {
  delete process.env.PLATFORM_ADMIN_EMAIL;
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  mockState.cookie = "";
  mockState.host = "";
  await seedFixture();
  const inst = await queryGet("SELECT id, name FROM institute LIMIT 1");
  sunshineIid = String(inst!.id);
  sunshineName = String(inst!.name);
  const owner = await queryGet("SELECT id, email FROM account WHERE role = 'owner'");
  ownerId = String(owner!.id);
  ownerEmail = String(owner!.email);
  const operator = await queryGet("SELECT id FROM account WHERE email = ?", OPERATOR_EMAIL);
  operatorId = String(operator!.id);
  // The seeded demo daycare ships without a web prefix (prod gets one from
  // the operator); give it one so the subdomain host resolves like prod.
  const { setInstituteSubdomain } = await import("@/lib/store");
  await setInstituteSubdomain(sunshineIid, SUNSHINE_SUBDOMAIN);
  // Every test sees the same seed data: one request with a real Vikunja
  // task id + URL, so link presence/absence is about the viewer's gate only.
  const req = await createEnhancementRequest({
    instituteId: sunshineIid,
    title: "Morning attendance export",
    description: "One click to export who is checked in.",
    requestedByAccountId: ownerId,
    customerRequest: sunshineName,
  });
  await applyLinearWriteBack(req.id, sunshineIid, {
    kind: "linear_created",
    linearIssueId: "VJ-77",
    linearIssueUrl: "https://tasks.kiddy.test/112",
  });
});

async function renderPage(searchParams: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import("@/app/portal/enhancements/page");
  return renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (Page as any)({ searchParams })
  );
}

describe("the Vikunja link gate (superadmin-only, KID-489 item 7)", () => {
  it("the owner sees the list but NEVER the Vikunja column or link", async () => {
    mockState.host = `${SUNSHINE_SUBDOMAIN}.${APEX}`;
    mockState.cookie = sessionCookieFor(ownerId, "owner", ownerEmail);
    const html = await renderPage();
    expect(html).toContain("Enhancements requests");
    expect(html).toContain("Morning attendance export");
    // The task URL exists in the row, yet must not leak anywhere in the
    // owner's DOM: no header, no link, no placeholder cell.
    expect(html).not.toContain("tasks.kiddy.test/112");
    expect(html).not.toContain("Open in Vikunja");
    expect(html).not.toContain(">Vikunja<");
    expect(html).not.toContain("افتح في Vikunja");
  });

  it("the platform superadmin gets the Open-in-Vikunja link", async () => {
    mockState.host = `${SUNSHINE_SUBDOMAIN}.${APEX}`;
    mockState.cookie = sessionCookieFor(operatorId, "platform", OPERATOR_EMAIL);
    const html = await renderPage();
    expect(html).toContain("Morning attendance export");
    expect(html).toContain("Open in Vikunja");
    expect(html).toContain("https://tasks.kiddy.test/112");
  });

  it("the superadmin gate is BOTH role and allowlist email: a non-allowlisted sentinel-role session is refused", async () => {
    // The allowlist is narrowed AWAY from the seeded operator, so the
    // platform sentinel role alone must be refused — email matters too.
    process.env.PLATFORM_ADMIN_EMAIL = "other-operator@kiddy.test";
    mockState.host = `${SUNSHINE_SUBDOMAIN}.${APEX}`;
    mockState.cookie = sessionCookieFor(operatorId, "platform", OPERATOR_EMAIL);
    let digest = "";
    try {
      await renderPage();
    } catch (err) {
      digest = String((err as { digest?: unknown }).digest ?? "");
    }
    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain("/portal/dashboard");
    // Restore the default (unset → fallback allowlist includes the operator)
    delete process.env.PLATFORM_ADMIN_EMAIL;
  });

  it("the allowlisted superadmin is fully allowed when the env allowlist names them", async () => {
    // A narrowed allowlist that still contains the operator: role + email
    // both on the gate → the link renders (mirrors prod's operator list).
    process.env.PLATFORM_ADMIN_EMAIL = OPERATOR_EMAIL;
    mockState.host = `${SUNSHINE_SUBDOMAIN}.${APEX}`;
    mockState.cookie = sessionCookieFor(operatorId, "platform", OPERATOR_EMAIL);
    const html = await renderPage();
    expect(html).toContain("Open in Vikunja");
    delete process.env.PLATFORM_ADMIN_EMAIL;
  });
});

describe("the enhancements table header renders inline (KID-489 item 7)", () => {
  it("header cells use .table-label and never the stacking .label class", async () => {
    mockState.host = `${SUNSHINE_SUBDOMAIN}.${APEX}`;
    mockState.cookie = sessionCookieFor(operatorId, "platform", OPERATOR_EMAIL);
    const html = await renderPage();
    expect(html).toContain('class="table-label"');
    // Form field labels may still use `.label` legitimately; nothing inside
    // <th> may — that class's `display: block` stacked the header cells.
    expect(html).not.toMatch(/<th[^>]*class="label"/);
  });

  it("the .table-label CSS rule keeps label styling without display:block", async () => {
    const fs = await import("fs/promises");
    const css = await fs.readFile("app/globals.css", "utf8");
    const start = css.indexOf(".table-label");
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("font-size: 13px");
    expect(rule).toContain("font-weight: 600");
    expect(rule).not.toContain("display: block");
  });
});

describe("the Vikunja label ships in EN + AR", () => {
  it("the link label reads Open in Vikunja in both dictionaries", () => {
    expect(dictionaries.en.enhancements.linearLink).toBe("Open in Vikunja");
    expect(dictionaries.ar.enhancements.linearLink).toBe("افتح في Vikunja");
    expect(keysOf(dictionaries.en as never)).toContain("enhancements.linearLink");
  });
});

describe("the page gate still refuses every daycare role", () => {
  it.each(["admin", "staff", "carer", "parent"] as const)(
    "a %s session is redirected to /portal/dashboard",
    async (role) => {
      // The gate fires before any reads keyed by the account id, so a
      // synthetic id is safe (exactly the kid264 pattern).
      const accountId = `probe-${role}-id`;
      mockState.host = `${SUNSHINE_SUBDOMAIN}.${APEX}`;
      mockState.cookie = sessionCookieFor(accountId, role, "probe@sunshinedaycare.test");
      let digest = "";
      try {
        await renderPage();
      } catch (err) {
        digest = String((err as { digest?: unknown }).digest ?? "");
      }
      expect(digest).toContain("NEXT_REDIRECT");
      expect(digest).toContain("/portal/dashboard");
    }
  );
});
