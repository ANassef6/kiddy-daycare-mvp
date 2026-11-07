// KID-481: super-admin Billing + Insights page — the stable tool registry,
// the best-effort usage recorder, the cross-tenant aggregation for the
// Insights tab, the labeled historical backfill, the operator guards on the
// billing/insights surface, and i18n key parity for the new surface.

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BACKFILL_RULES,
  INSIGHT_PRESETS,
  recordToolUsage,
  insightsTimeframe,
  toolInsights,
  TOOL_KEYS,
  TOOLS,
  backfillToolUsageEstimates,
  isToolKey,
} from "@/lib/tool-usage";
import { queryAll, queryGet, queryRun, type Row } from "@/lib/db";
import {
  tr,
  dictionaries,
  keysOf,
} from "@/lib/i18n";
import { seedFixture } from "../helpers";

let iid: string;
let owner: string;

async function countUsage(where = "1=1", ...args: unknown[]): Promise<number> {
  const rows = await queryAll(`SELECT COUNT(*) AS n FROM tool_usage_event WHERE ${where}`, ...args);
  return Number((rows[0] as { n?: unknown })?.n ?? 0);
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  owner = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
});

describe("tool registry (KID-481)", () => {
  it("has the 21 stable keys including every tool named in the deliverable", () => {
    expect([...TOOL_KEYS].sort()).toEqual(
      [
        "dashboard",
        "newsfeed",
        "calendar",
        "events",
        "children",
        "attendance",
        "consents",
        "learning",
        "staff",
        "messages",
        "reports",
        "report-center",
        "supplies",
        "rooms",
        "finance",
        "forms",
        "surveys",
        "incidents",
        "drive",
        "enhancements",
        "billing",
      ].sort()
    );
  });

  it("gives every tool a non-empty label and the key list is frozen", () => {
    for (const key of TOOL_KEYS) {
      expect(TOOLS[key].label.length).toBeGreaterThan(0);
    }
    expect(isToolKey("billing")).toBe(true);
    expect(isToolKey("definitely-not-a-tool")).toBe(false);
  });
});

describe("insightsTimeframe (KID-481)", () => {
  const today = new Date("2026-03-15T12:00:00.000Z");

  it("presets are inclusive windows ending today (7/30/90)", () => {
    const tf = insightsTimeframe({ days: 7 }, today);
    expect(tf).toEqual({ from: "2026-03-09", to: "2026-03-15", presetDays: 7 });
    expect(insightsTimeframe({ days: 30 }, today)).toEqual({
      from: "2026-02-14",
      to: "2026-03-15",
      presetDays: 30,
    });
    expect(insightsTimeframe({ days: 90 }, today).from).toBe("2025-12-16");
  });

  it("accepts an inclusive custom range and clamps reversed bounds", () => {
    expect(
      insightsTimeframe({ from: "2026-01-01", to: "2026-01-31" }, today)
    ).toEqual({ from: "2026-01-01", to: "2026-01-31", presetDays: null });
    // `to` < `from` drains to an empty set — clamp so the page can't blank out.
    const clamped = insightsTimeframe({ from: "2026-01-31", to: "2026-01-01" }, today);
    // Clamped onto the first day so a reversed range can never blank the page.
    expect(clamped.from).toBe("2026-01-31");
    expect(clamped.to).toBe("2026-01-31");
  });

  it("falls back to the 30-day preset on missing or malformed custom dates", () => {
    expect(insightsTimeframe({}, today).presetDays).toBe(30);
    expect(insightsTimeframe({ days: "nope" }, today).presetDays).toBe(30);
    expect(
      insightsTimeframe({ from: "01/02/2026", to: "2026-01-02" }, today).presetDays
    ).toBe(30);
    // SQL date boundary probing must not become a timeframe.
    expect(
      insightsTimeframe({ from: "9999-99-99", to: "2026-01-02" }, today).presetDays
    ).toBe(30);
  });

  it("rejects a `days` value outside the presets", () => {
    expect(insightsTimeframe({ days: 8 }, today).presetDays).toBe(30);
    expect(insightsTimeframe({ days: 30.5 }, today).presetDays).toBe(30);
  });

  it("exposes exactly the 7/30/90 presets", () => {
    expect(INSIGHT_PRESETS.map((p) => p.days)).toEqual([7, 30, 90]);
  });
});

describe("recordToolUsage (KID-481)", () => {
  it("records one row per call with tenant, account and default source", async () => {
    expect(await countUsage()).toBe(0);
    await recordToolUsage({ instituteId: iid, accountId: owner, toolKey: "attendance" });
    expect(await countUsage()).toBe(1);
    const row = (await queryGet("SELECT * FROM tool_usage_event WHERE tool_key = 'attendance'")) as Row;
    expect(row.tool_key).toBe("attendance");
    expect(row.institute_id).toBe(iid);
    expect(row.account_id).toBe(owner);
    expect(row.source).toBe("portal");
  });

  it("accepts child/platform/null-tenant variants and JSON metadata", async () => {
    await recordToolUsage({
      instituteId: null,
      accountId: owner,
      toolKey: "newsfeed",
      source: "child",
      metadata: { view: "activities" },
    });
    const row = (await queryGet(
      "SELECT * FROM tool_usage_event WHERE source = 'child'"
    )) as Row;
    expect(row.institute_id).toBeNull();
    expect(row.tool_key).toBe("newsfeed");
    expect(JSON.parse(String(row.metadata))).toEqual({ view: "activities" });
    // Platform-surface events (institute NULL) get no account to filter on.
    await recordToolUsage({ toolKey: "billing", source: "platform" });
    expect(await countUsage("source = 'platform' AND institute_id IS NULL")).toBe(1);
  });

  it("is best-effort: failures are logged, never thrown", async () => {
    const err = console.error;
    console.error = () => {};
    try {
      // FK violation of a nonexistent account breaks the INSERT; the helper
      // must swallow it exactly like recordAuditEvent does.
      await recordToolUsage({ instituteId: iid, accountId: "no-such-account-yet-hopefully-never", toolKey: "dashboard" });
      expect(await countUsage("account_id = 'no-such-account-yet-hopefully-never'")).toBe(0);
    } finally {
      console.error = err;
    }
  });
});

describe("toolInsights aggregation (KID-481)", () => {
  it("aggregates totals, adoption across ACTIVE daycares, top and neglected tools, and the per-daycare breakdown", async () => {
    // A second (active) and third (disabled) daycare. Adoption denominators
    // count only the two active ones.
    await queryRun("INSERT INTO institute (id, name, active) VALUES ('inst-2', 'Beta Daycare', 1)");
    await queryRun("INSERT INTO institute (id, name, active) VALUES ('inst-3', 'Gone Daycare', 0)");

    // Active daycare 1: dashboard x2 + attendance x1
    await recordToolUsage({ instituteId: iid, accountId: owner, toolKey: "dashboard" });
    await recordToolUsage({ instituteId: iid, accountId: owner, toolKey: "dashboard" });
    await recordToolUsage({ instituteId: iid, accountId: owner, toolKey: "attendance" });
    // Active daycare 2: dashboard x5
    for (let i = 0; i < 5; i++) {
      await recordToolUsage({ instituteId: "inst-2", accountId: owner, toolKey: "dashboard" });
    }
    // Disabled daycare: events exist but must not count in per-daycare duties
    // outside its row (the breakdown still lists it, disabled, count shown).
    await recordToolUsage({ instituteId: "inst-3", accountId: owner, toolKey: "messages" });
    // Old event outside the 7-day window is excluded by the timeframe.
    await queryRun(
      "INSERT INTO tool_usage_event (id, institute_id, account_id, tool_key, source, occurred_at) VALUES ('old-1', ?, ?, 'drive', 'portal', ?)",
      iid,
      owner,
      daysAgo(20)
    );
    // Platform-surface event (operator's own billing visit).
    await recordToolUsage({ instituteId: null, accountId: owner, toolKey: "billing", source: "platform", metadata: { surface: "insights" } });

    const tf = insightsTimeframe({ days: 7 }, new Date());
    const insights = await toolInsights(tf);

    expect(insights.totalDaycares).toBe(3);
    expect(insights.activeDaycares).toBe(2);

    const dashboard = insights.tools.find((t) => t.toolKey === "dashboard")!;
    expect(dashboard.events).toBe(7);
    expect(dashboard.daycaresUsing).toBe(2);
    expect(dashboard.totalDaycares).toBe(2);

    const attendance = insights.tools.find((t) => t.toolKey === "attendance")!;
    expect(attendance.events).toBe(1);
    expect(attendance.daycaresUsing).toBe(1);

    // Old row excluded, platform surface counted in the grand total.
    expect(insights.tools.find((t) => t.toolKey === "drive")!.events).toBe(0);
    expect(insights.totalEvents).toBe(10);
    expect(insights.platformEvents).toBe(1);

    // Top: dashboard first; neglected: zero-event tools rise (label-asc tie).
    expect(insights.top[0]!.toolKey).toBe("dashboard");
    const zeroToolCount = insights.tools.filter((t) => t.events === 0).length;
    // Neglected is the ascending bottom-5 slice: all-zero events here, and
    // zero-event tools never appear in the top-5.
    expect(zeroToolCount).toBeGreaterThanOrEqual(5);
    expect(insights.neglected.every((t) => t.events === 0)).toBe(true);
    expect(insights.neglected[0]!.events).toBe(0);

    // Per-daycare breakdown: active first, busy-first; top tool per daycare.
    const breakdown = insights.daycares;
    expect(breakdown.map((d) => d.instituteId)).toContain(iid);
    expect(breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instituteId: "inst-2", events: 5, topTool: "dashboard", active: true }),
        expect.objectContaining({ instituteId: iid, events: 3, topTool: "dashboard", active: true }),
        expect.objectContaining({ instituteId: "inst-3", events: 1, active: false }),
      ])
    );
    // Inactive daycares sort after active ones.
    const firstInactive = breakdown.findIndex((d) => !d.active);
    expect(firstInactive).toBeGreaterThan(breakdown.findIndex((d) => d.active));
    // Disabled daycare's top tool is still derived from its own rows.
    const gone = breakdown.find((d) => d.instituteId === "inst-3")!;
    expect(gone.topTool).toBe("messages");
  });
});

describe("backfillToolUsageEstimates (KID-481)", () => {
  it("labels historical rows as estimates, is idempotent, and covers the seeded daycare's domain tables", async () => {
    expect(await countUsage("source = 'backfill'")).toBe(0);
    const inserted = await backfillToolUsageEstimates();
    // The demo seed fills newsfeed posts, events, children, rooms, consents,
    // staff, daily reports, forms and drive files for the seeded institute —
    // each produces one labeled estimate row per active daycare.
    expect(inserted).toBeGreaterThan(3);
    expect(await countUsage("source = 'backfill'")).toBe(inserted);

    const newsfeed = (await queryGet(
      "SELECT * FROM tool_usage_event WHERE tool_key = 'newsfeed' AND source = 'backfill'"
    )) as Row;
    expect(newsfeed.institute_id).toBe(iid);
    const meta = JSON.parse(String(newsfeed.metadata));
    expect(meta.estimate).toBe(true);
    expect(meta.historical_rows).toBeGreaterThan(0);
    // dated at the newest related record — a real derived timestamp in the
    // datetime('now') format, never a fabricated constant.
    expect(String(newsfeed.occurred_at)).toMatch(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/);

    // Idempotent: a second pass adds nothing.
    const again = await backfillToolUsageEstimates();
    expect(again).toBe(0);
    expect(await countUsage("source = 'backfill'")).toBe(inserted);
  });

  it("skips disabled daycares and has dashboard/report-center in the rules only via nothing (no fake stats)", async () => {
    await queryRun("INSERT INTO institute (id, name, active) VALUES ('inst-x', 'Dark Daycare', 0)");
    await backfillToolUsageEstimates();
    expect(await countUsage("institute_id = 'inst-x'")).toBe(0);
    const keys = BACKFILL_RULES.map((r) => r.toolKey);
    expect(keys).not.toContain("dashboard");
    expect(keys).not.toContain("report-center");
  });
});

describe("operator guards on the Billing/Insights surface (KID-481 static pins)", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the billing page double-checks role AND email allowlist for both tabs", () => {
    const page = read("app/platform/daycares/[id]/billing/page.tsx");
    expect(page).toContain("isPlatformOperatorRole(session.role)");
    expect(page).toContain("isPlatformOperatorEmail(session.email)");
    expect(page).toContain('redirect("/login")');
    // Insights reuses the same page/process, no separate unguarded entry.
    expect(page).toContain('searchParams.tab === "insights"');
  });

  it("the gear link on the platform list still targets the tabbed page", () => {
    const listPage = read("app/platform/page.tsx");
    expect(listPage).toContain("href={`/platform/daycares/${instId}/billing`}");
  });

  it("the tab bar exists with Billing and Insights, and insights view renders aggregate tables", () => {
    const insightsView = read("app/platform/daycares/[id]/billing/insights-view.tsx");
    expect(insightsView).toContain("insightsTopUsed");
    expect(insightsView).toContain("insightsNeglected");
    expect(insightsView).toContain("insightsPerDaycare");
    expect(insightsView).toContain("insightsToolTable");
    // Labels must resolve through the platform.* dot path, or the table
    // renders raw "toolDashboard" keys (regression pinned from KID-481 QA).
    expect(insightsView).toContain("`platform.${toolDictKey(toolKey)}`");
    const page = read("app/platform/daycares/[id]/billing/page.tsx");
    expect(page).toContain("platform.billingTab");
    expect(page).toContain("platform.insightsTab");
  });
});

describe("i18n parity for the KID-481 surface (KID-481)", () => {
  const KEYS = [
    "platform.billingTab",
    "platform.insightsTab",
    "platform.insightsTitle",
    "platform.insightsSubtitle",
    "platform.insightsTimeframe",
    "platform.insights7",
    "platform.insights30",
    "platform.insights90",
    "platform.insightsCustom",
    "platform.insightsCustomFrom",
    "platform.insightsCustomTo",
    "platform.insightsCustomApply",
    "platform.insightsInvalidCustom",
    "platform.insightsBackfillNote",
    "platform.insightsBackfilled",
    "platform.insightsTotals",
    "platform.insightsToolTable",
    "platform.insightsDaycaresUsing",
    "platform.insightsAdoption",
    "platform.insightsTopUsed",
    "platform.insightsNeglected",
    "platform.insightsNoData",
    "platform.insightsPerDaycare",
    "platform.insightsDaycareName",
    "platform.insightsInactive",
    "platform.insightsEstimate",
    "platform.insightsSources",
  ];

  it("every new key is present and non-empty in EN and AR with full dict parity", () => {
    for (const dict of [dictionaries.en, dictionaries.ar]) {
      for (const key of KEYS) {
        const value = tr(dict, key);
        expect(value).not.toBe("");
        expect(value.startsWith("MISSING:")).toBe(false);
      }
    }
    // Whole-dict parity stays green (no orphan EN or AR-only keys).
    expect(keysOf(dictionaries.en).sort()).toEqual(keysOf(dictionaries.ar).sort());
  });

  it("every tool key has a localized label for both locales", () => {
    for (const dict of [dictionaries.en, dictionaries.ar]) {
      for (const toolKey of TOOL_KEYS) {
        const dot = "tool" + toolKey.split("-").map((s) => s[0]!.toUpperCase() + s.slice(1)).join("");
        const value = tr(dict, `platform.${dot}`);
        expect(value).not.toBe("");
        expect(value.startsWith("MISSING:")).toBe(false);
      }
    }
  });

  it("interpolates the insightsBackfilled count variable", () => {
    const out = tr(dictionaries.en, "platform.insightsBackfilled", { count: 42 });
    expect(out).toContain("42");
  });
});
