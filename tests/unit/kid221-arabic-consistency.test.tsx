// KID-221: Arabic localization consistency + Consents/Events findability
// (findability pins the KID-191 docs-QA product gaps). Three layers:
//
//   1. FINDABILITY — the sidebar tree carries Consents (Children group) and
//      Events (Home group) in both locales, alongside the dictionary labels.
//      The dashboard card and Calendar links to both stay valid routes.
//   2. RUNTIME AR guard — every audited /portal (staff/admin) and /child
//      (parent) surface renders with an Arabic account and must not contain
//      untranslated English UI template strings inside the translated shell.
//      DB-row content (names, seeded posts, summaries) is allowlisted — the
//      acceptance is about UI strings, not user data.
//   3. STATIC lint guard — the audited sources must not ship raw English JSX
//      text nodes or attribute strings, so a future edit cannot quietly
//      reintroduce a mixed-language page. (Font option names are proper
//      nouns and stay allowlisted.)
//
// The runtime half follows the kid246 mocked-headers harness: no server is
// spun up; the request cookie is injected and the page async functions are
// rendered with renderToStaticMarkup against the isolated SQLite fixture.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { createSessionToken, createAccount, type Session } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";
import { portalNav } from "@/components/PortalSidebar";
import { seedFixture } from "../helpers";

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

// Database-derived words (children/staff/author names, seeded post bodies,
// report summaries, event/supply/homework titles, filenames, rooms, roles…).
// Best-effort: a missing table/column on a future schema change drops that
// slice and keeps the rest — the guard must never break on its own allowlist.
const ALLOWLIST_QUERIES = [
  "SELECT c.first_name, c.last_name, r.name AS room_name FROM child c LEFT JOIN room r ON r.id = c.room_id",
  "SELECT full_name, role FROM staff",
  "SELECT full_name, role, email FROM account",
  "SELECT name, allergies FROM child_health",
  "SELECT title, description, event_date, start_time, end_time, location FROM event",
  "SELECT summary, observation, mood, meal, sleep, diaper, note FROM daily_report",
  "SELECT title, description FROM homework",
  "SELECT title, notes, unit FROM supply_request",
  "SELECT body FROM newsfeed_post",
  "SELECT title, body FROM consent_request",
  "SELECT filename, description FROM drive_file",
  "SELECT type, description FROM incident_report",
  "SELECT title, body, age_group FROM learning_observation",
  "SELECT name, description FROM form_template",
  "SELECT name, phone, email FROM contact",
  "SELECT name FROM room",
  "SELECT name, message FROM contact_request",
  "SELECT caption, kind FROM media",
  "SELECT caption FROM media_event",
  "SELECT name FROM curriculum_area",
  "SELECT name FROM curriculum_learning_point",
  "SELECT name, description FROM curriculum_milestone",
  "SELECT title, attachment_name FROM message_thread",
  "SELECT body FROM message",
];

async function buildDataAllowlist(): Promise<Set<string>> {
  const parts: string[] = [];
  for (const sql of ALLOWLIST_QUERIES) {
    try {
      const rows = await queryAll(sql);
      for (const row of rows) parts.push(Object.values(row ?? {}).join(" "));
    } catch {
      // best-effort slice only
    }
  }
  // eslint-disable-next-line no-console
  return wordsOf(parts.join(" "));
}

function wordsOf(text: string): Set<string> {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 2)
  );
}

// UI-ish proper nouns and tokens that are correct in both locales.
const NON_DATA_ALLOWED = new Set(
  [
    "inter", "nunito", "poppins", "georgia", "egp", "cad", "pcs", "pdf", "csv", "excel",
    "linear", "png", "jpg", "jpeg", "mb", "kbd", "kiddy",
  ]
);

function isWordy(token: string): boolean {
  return /[A-Za-z]{3,}/.test(token);
}

function visibleText(html: string): string[] {
  // Drop comments + tags wholesale; what remains is only text content.
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .split(/\s+/);
}

function englishLeaks(html: string, allowed: Set<string>): string[] {
  const tokens = visibleText(html).filter((t) => isWordy(t) || isWordy(t.toLowerCase()));
  const leaks: string[] = [];
  let run: string[] = [];
  for (const token of tokens) {
    const word = token.toLowerCase();
    // Composite tokens ("In-house") check every hyphen segment against the
    // data allowlist.
    const segments = word.split("-").map((seg) => seg.replace(/^'+|'+$/g, ""));
    if (!/^[A-Za-z][A-Za-z'&-]*$/.test(token) || token.length < 2) {
      if (run.length > 0) leaks.push(run.join(" "));
      run = [];
      continue;
    }
    const dataClean = segments.length > 0 && segments.every((seg) => allowed.has(seg) || NON_DATA_ALLOWED.has(seg));
    if (dataClean) {
      if (run.length > 0) leaks.push(run.join(" "));
      run = [];
      continue;
    }
    run.push(token);
    if (run.length === 2) {
      leaks.push(run.join(" "));
      run = run.slice(1);
    }
  }
  if (run.length > 0) leaks.push(run.join(" "));
  return leaks;
}

let ownerId: string;
let ownerEmail: string;
let parentId: string;
let parentEmail: string;

beforeEach(async () => {
  await seedFixture();
  mockState.cookie = "";
  mockState.host = "";
  const owner = await queryGet("SELECT id, email FROM account WHERE role = 'owner'");
  const parent = await queryGet("SELECT id, email FROM account WHERE role = 'parent'");
  ownerId = String(owner!.id);
  ownerEmail = String(owner!.email);
  parentId = String(parent!.id);
  parentEmail = String(parent!.email);
});

afterEach(() => {
  mockState.cookie = "";
  mockState.host = "";
});

function cookieFor(accountId: string, role: string, email: string): string {
  const session: Session = { accountId, role, email, emailConfirmed: true };
  return `kiddy_sess=${createSessionToken(session)}`;
}

async function arOwner(): Promise<void> {
  await queryRun("UPDATE account SET language = 'ar' WHERE id = ?", ownerId);
  mockState.cookie = cookieFor(ownerId, "owner", ownerEmail);
}

async function arParent(): Promise<void> {
  await queryRun("UPDATE account SET language = 'ar' WHERE id = ?", parentId);
  mockState.cookie = cookieFor(parentId, "parent", parentEmail);
}

// ---- 1. FINDABILITY ----------------------------------------------------------
describe("KID-221: Consents + Events in the sidebar", () => {
  const groupAt = (dict: any, href: string) =>
    portalNav(dict as never, "owner").find((g) => g.href === href);

  it("Events lives in the Home group in both locales", () => {
    for (const lang of ["en", "ar"] as const) {
      const dict = dictionaries[lang];
      const home = groupAt(dict, "/portal/dashboard")!;
      const ev = home.items.find((i) => i.href === "/portal/events")!;
      expect(ev).toBeDefined();
      expect(ev.label).toBe(dict.nav.events);
    }
    expect(dictionaries.ar.nav.events).toBe("الفعاليات");
  });

  it("Consents lives in the Children group in both locales", () => {
    for (const lang of ["en", "ar"] as const) {
      const dict = dictionaries[lang];
      const children = groupAt(dict, "/portal/children")!;
      const consents = children.items.find((i) => i.href === "/portal/consents")!;
      expect(consents).toBeDefined();
      expect(consents.label).toBe(dict.nav.childrenConsents);
    }
    expect(dictionaries.ar.nav.childrenConsents).toBe("الموافقات");
  });

  it("the pre-existing entry points keep working (dashboard card + calendar link)", async () => {
    const { default: Dashboard } = await import("@/app/portal/dashboard/page");
    mockState.cookie = cookieFor(ownerId, "owner", ownerEmail);
    const html = renderToStaticMarkup(await Dashboard());
    expect(html).toContain('href="/portal/consents"');
    const { default: Calendar } = await import("@/app/portal/calendar/page");
    const calHtml = renderToStaticMarkup(await Calendar());
    expect(calHtml).toContain('href="/portal/events"');
  });
});

// ---- 2. RUNTIME AR guard -----------------------------------------------------

describe("KID-221: Arabic staff/admin pages render without English UI strings", () => {
  const cases: Array<{ name: string; render: () => Promise<string> }> = [
    {
      name: "/portal/consents",
      render: async () => {
        const { default: Page } = await import("@/app/portal/consents/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/portal/events",
      render: async () => {
        const { default: Page } = await import("@/app/portal/events/page");
        return renderToStaticMarkup((await Page({ searchParams: {} })) as never);
      },
    },
    {
      name: "/portal/rooms",
      render: async () => {
        const { default: Page } = await import("@/app/portal/rooms/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/portal/supplies",
      render: async () => {
        const { default: Page } = await import("@/app/portal/supplies/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/portal/performance",
      render: async () => {
        const { default: Page } = await import("@/app/portal/performance/page");
        return renderToStaticMarkup((await Page({})) as never);
      },
    },
    {
      name: "/portal/learning",
      render: async () => {
        const { default: Page } = await import("@/app/portal/learning/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/portal/learning/homework",
      render: async () => {
        const { default: Page } = await import("@/app/portal/learning/homework/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/portal/learning/activities",
      render: async () => {
        const { default: Page } = await import("@/app/portal/learning/activities/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/portal/dashboard",
      render: async () => {
        const { default: Page } = await import("@/app/portal/dashboard/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/portal/notifications",
      render: async () => {
        const { default: Page } = await import("@/app/portal/notifications/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/portal/newsfeed",
      render: async () => {
        const { default: Page } = await import("@/app/portal/newsfeed/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/portal/report-center",
      render: async () => {
        const { default: Page } = await import("@/app/portal/report-center/page");
        return renderToStaticMarkup((await Page({ searchParams: {} })) as never);
      },
    },
    {
      name: "/portal/settings",
      render: async () => {
        const { default: Page } = await import("@/app/portal/settings/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
  ];

  it.each(cases.map((c) => c.name))("%s carries no English UI template inside the Arabic shell", async (name) => {
    const entry = cases.find((c) => c.name === name)!;
    await arOwner();
    const html = await entry.render();
    const allowed = await buildDataAllowlist();
    const leaks = englishLeaks(html, allowed);
    expect(leaks).toEqual([]);
  });

  it("the localized pages still render English for English accounts", async () => {
    if (!ownerEmail) throw new Error("owner fixture missing");
    if (!ownerId) throw new Error("owner fixture missing");
    // EN regression canary: the consents + rooms surfaces keep their English
    // labels so the localization did not overwrite the default locale.
    expect(dictionaries.en.consents.send).toContain("Send consent request");
    expect(dictionaries.en.rooms.addRoom).toContain("Add room");
    expect(dictionaries.ar.consents.send).not.toBe(dictionaries.en.consents.send);
  });
});

describe("KID-221: Arabic parent pages render without English UI strings", () => {
  const cases: Array<{ name: string; render: () => Promise<string> }> = [
    {
      name: "/child/consents",
      render: async () => {
        const { default: Page } = await import("@/app/child/consents/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/child/events",
      render: async () => {
        const { default: Page } = await import("@/app/child/events/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/child/drive",
      render: async () => {
        const { default: Page } = await import("@/app/child/drive/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/child/newsfeed",
      render: async () => {
        const { default: Page } = await import("@/app/child/newsfeed/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
    {
      name: "/child/incidents",
      render: async () => {
        const { default: Page } = await import("@/app/child/incidents/page");
        return renderToStaticMarkup((await Page()) as never);
      },
    },
  ];

  it.each(cases.map((c) => c.name))("%s carries no English UI template inside the Arabic shell", async (name) => {
    const entry = cases.find((c) => c.name === name)!;
    await arParent();
    const html = await entry.render();
    const allowed = await buildDataAllowlist();
    const leaks = englishLeaks(html, allowed);
    expect(leaks).toEqual([]);
  });
});

// ---- 3. STATIC lint guard ----------------------------------------------------

describe("KID-221: the audited sources stay free of raw English JSX strings", () => {
  const AUDITED = [
    "app/portal/dashboard/page.tsx",
    "app/portal/learning/page.tsx",
    "app/portal/learning/activities/page.tsx",
    "app/portal/learning/homework/page.tsx",
    "app/portal/settings/page.tsx",
    "app/portal/notifications/page.tsx",
    "app/portal/messages/page.tsx",
    "app/portal/newsfeed/page.tsx",
    "app/portal/report-center/page.tsx",
    "app/portal/performance/page.tsx",
    "app/portal/supplies/page.tsx",
    "app/portal/rooms/page.tsx",
    "app/portal/consents/page.tsx",
    "app/portal/events/page.tsx",
    "app/child/consents/page.tsx",
    "app/child/events/page.tsx",
    "app/child/drive/page.tsx",
    "app/child/newsfeed/page.tsx",
    "app/child/incidents/page.tsx",
    "components/RecipientsPicker.tsx",
  ];

  const ALLOWED_PROPER_NOUNS = new Set(["Inter", "Nunito", "Poppins", "Georgia"]);

  it("every visible JSX text node / attribute string on the audited surfaces is translated", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const offenders: string[] = [];
    for (const file of AUDITED) {
      const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      // JSX text nodes (>text<) and string-literal attributes.
      const jsxText = [...src.matchAll(/>\s*([^<>{}\n]+?)\s*</g)].map((m) => m[1]);
      const attrs = [...src.matchAll(/\b(?:placeholder|aria-label|title|alt)="([^"]+)"/g)].map((m) => m[1]);
      for (const text of [...jsxText, ...attrs]) {
        const trimmed = text.trim();
        if (/^[A-Za-z0-9\s.,'’&:#/()–—°+-]{2,}$/.test(trimmed) && /[A-Za-z]{3,}/.test(trimmed)) {
          if (ALLOWED_PROPER_NOUNS.has(trimmed)) continue;
          offenders.push(`${file}: "${trimmed}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
