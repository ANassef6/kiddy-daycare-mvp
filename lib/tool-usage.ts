// KID-481: cross-tenant tool usage analytics for the super-admin Billing +
// Insights page.
//
// Three jobs:
//  1. a stable registry of every available tool (keys never change; route
//     paths may). One source of truth for keys, labels and route aliases so
//     instrumentation sites stay in sync with the Insights page.
//  2. recordToolUsage() — best-effort event writes in the same style as
//     lib/audit.ts (KID-477): a failed usage row never blocks the page or
//     action it describes; failures are logged loudly, never silently.
//  3. toolInsights() — operator-only aggregation over a timeframe: per-tool
//     event counts and adoption across ACTIVE daycares, top-used and
//     neglected tools, and a per-daycare breakdown. Counts only; no row
//     content crosses tenants (daycare owners never see this surface).
//
// The schema is 0033_tool_usage_event.sql (mirrored in lib/sqlite-schema.ts).
// Historical usage is backfilled from existing domain tables by
// backfillToolUsageEstimates(): one estimate event per (daycare, tool), dated
// at the latest related record, labeled `"estimate": true` in metadata —
// estimates are never shown as literal recorded visits in the UI.

import { queryAll, queryGet, queryRun, uid } from "@/lib/db";
import type { Row } from "@/lib/db";

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

/**
 * Stable tool keys. NEVER rename: values are stored in tool_usage_event.
 * Long dash keys are fine; renames or rekeying requires a data migration and
 * an explicit plan to merge old keys in the aggregation below.
 */
export const TOOL_KEYS = [
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
] as const;

export type ToolKey = (typeof TOOL_KEYS)[number];

export type ToolDef = {
  label: string;
  /** English label (AR labels come from the i18n dict on the page). */
  hint: string;
};

export const TOOLS: Record<ToolKey, ToolDef> = {
  dashboard: { label: "Dashboard", hint: "portal dashboard home" },
  newsfeed: { label: "Newsfeed", hint: "posts, likes, comments" },
  calendar: { label: "Calendar", hint: "calendar view, schedules" },
  events: { label: "Events", hint: "event planning and dates" },
  children: { label: "Children", hint: "roster, profiles, billing per child" },
  attendance: { label: "Attendance", hint: "check-in/out and attendance history" },
  consents: { label: "Consents", hint: "permission requests and responses" },
  learning: { label: "Learning", hint: "activities, curriculum, homework" },
  staff: { label: "Staff", hint: "staff roster and schedules" },
  messages: { label: "Messages", hint: "parent/staff messaging" },
  reports: { label: "Reports", hint: "daily reports" },
  "report-center": { label: "Report center", hint: "operational report hub" },
  supplies: { label: "Supplies", hint: "supply requests and inventory" },
  rooms: { label: "Rooms", hint: "room management" },
  finance: { label: "Finance", hint: "child billing ledger" },
  forms: { label: "Forms", hint: "forms and responses" },
  surveys: { label: "Surveys", hint: "surveys and responses" },
  incidents: { label: "Incidents", hint: "incident reports" },
  drive: { label: "Parent drive", hint: "files shared with parents" },
  enhancements: { label: "Enhancements", hint: "enhancement requests" },
  billing: { label: "Billing", hint: "account/daycare billing" },
};

export function isToolKey(value: string): value is ToolKey {
  return (TOOL_KEYS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export type ToolUsageSource = "portal" | "child" | "platform" | "backfill";

export type ToolUsageInput = {
  instituteId?: string | null;
  accountId?: string | null;
  toolKey: ToolKey;
  source?: ToolUsageSource;
  /** Bounded, non-sensitive details (ids, counts). */
  metadata?: Record<string, unknown> | null;
};

/**
 * Best-effort write of one tool usage event. Never throws for table-write
 * errors — the page or action must always proceed; failures are logged.
 */
export async function recordToolUsage(input: ToolUsageInput): Promise<void> {
  try {
    await queryRun(
      `INSERT INTO tool_usage_event (id, institute_id, account_id, tool_key, source, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      uid(),
      input.instituteId ?? null,
      input.accountId ?? null,
      input.toolKey,
      input.source ?? "portal",
      input.metadata && Object.keys(input.metadata).length > 0
        ? JSON.stringify(input.metadata)
        : null
    );
  } catch (err) {
    console.error("[tool-usage] recordToolUsage failed", {
      toolKey: input.toolKey,
      instituteId: input.instituteId ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Timeframes
// ---------------------------------------------------------------------------

export const INSIGHT_PRESETS = [
  { days: 7, label: "insights7" },
  { days: 30, label: "insights30" },
  { days: 90, label: "insights90" },
] as const;

/** Bounded YYYY-MM-DD day (both bounds inclusive), or null when invalid. */
function parseDay(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip: JS Date normalizes 2026-02-30 into 2026-03-02 — reject it.
  if (d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

/** End-of-day-exclusive bound in the datetime('now') text space (audit parity). */
function dayEndExclusive(to: string): string {
  return `${to} 23:59:59`;
}

export type InsightsTimeframe = {
  from: string;
  to: string;
  /** 7 | 30 | 90 when a preset was used (or 30 fallback); null with custom. */
  presetDays: 7 | 30 | 90 | null;
};

/**
 * Build the query timeframe. Presets are `?days=7|30|90` (inclusive of
 * today); custom is `?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive both ends;
 * `to` before `from` is clamped so the page can never drain an empty set).
 */
export function insightsTimeframe(
  params: { days?: unknown; from?: unknown; to?: unknown },
  today = new Date()
): InsightsTimeframe {
  const days = Number(params.days);
  if (days === 7 || days === 30 || days === 90) {
    const from = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    return {
      from: from.toISOString().slice(0, 10),
      to: today.toISOString().slice(0, 10),
      presetDays: days,
    };
  }
  const from = parseDay(params.from);
  const to = parseDay(params.to);
  if (from && to) {
    return { from, to: to < from ? from : to, presetDays: null };
  }
  // Invalid/missing custom dates fall back to the matching-presets default.
  const toDay = today.toISOString().slice(0, 10);
  const fromDay = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return { from: fromDay, to: toDay, presetDays: 30 };
}

// ---------------------------------------------------------------------------
// Aggregation (operator-only reads; aggregate counts, no row content)
// ---------------------------------------------------------------------------

export type ToolUsageRow = {
  toolKey: ToolKey;
  label: string;
  /** Events recorded in the timeframe for this tool (all daycares). */
  events: number;
  /** Daycares with >= 1 event for this tool in the timeframe. */
  daycaresUsing: number;
  /** Adoption denominator: ACTIVE daycares on the platform. */
  totalDaycares: number;
};

export type DaycareUsageRow = {
  instituteId: string;
  name: string;
  active: boolean;
  events: number;
  /** Most-used tool for this daycare ("—" when none), and its count. */
  topTool: ToolKey | null;
  topToolEvents: number;
};

export type InsightsByTimeframe = {
  from: string;
  to: string;
  /** 7 | 30 | 90 when the timeframe came from a preset; null for custom. */
  presetDays: 7 | 30 | 90 | null;
  totalDaycares: number;
  activeDaycares: number;
  totalEvents: number;
  /** Events with no daycare context (the operator's own billing surface). */
  platformEvents: number;
  tools: ToolUsageRow[];
  /** By event count desc, then label asc (ties stable). */
  top: ToolUsageRow[];
  /** Zero events first, then lowest event counts (ties label asc). */
  neglected: ToolUsageRow[];
  /** Per-daycare totals, busy-first, inactive daycares after active ones. */
  daycares: DaycareUsageRow[];
};

async function instituteCounts(): Promise<{ total: number; active: number }> {
  const rows = await queryAll(
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS active FROM institute"
  );
  const r = rows[0] ?? {};
  return { total: Number(r.total ?? 0), active: Number(r.active ?? 0) };
}

/**
 * Per-tool aggregation across the platform for the timeframe. Then a clipped
 * per-daycare top tool via one extra grouped read (no N+1: daycare names are
 * joined into the same GROUP BY read).
 */
export async function toolInsights(tf: InsightsTimeframe): Promise<InsightsByTimeframe> {
  const { total, active } = await instituteCounts();

  // ( institute_id, tool_key ) -> events  (NULL daycares → platform-surface events)
  const eventRows = await queryAll(
    `SELECT institute_id, tool_key, COUNT(*) AS n FROM tool_usage_event
     WHERE occurred_at >= ? AND occurred_at < ?
     GROUP BY institute_id, tool_key`,
    tf.from,
    dayEndExclusive(tf.to)
  );

  const perKeyEvents = new Map<string, number>();
  const perKeyDaycares = new Map<string, Set<string>>();
  const instituteEvents = new Map<string, number>();
  const instituteTopTool = new Map<string, { tool: ToolKey; n: number }>();

  for (const row of eventRows) {
    const key = String(row.tool_key);
    const n = Number(row.n ?? 0);
    const institute = row.institute_id == null ? null : String(row.institute_id);
    perKeyEvents.set(key, (perKeyEvents.get(key) ?? 0) + n);
    if (institute) {
      instituteEvents.set(institute, (instituteEvents.get(institute) ?? 0) + n);
      const current = instituteTopTool.get(institute);
      if (!current || n > current.n || (n === current.n && key < current.tool)) {
        instituteTopTool.set(institute, { tool: isToolKey(key) ? key : "dashboard", n });
      }
    }
    if (institute) {
      let set = perKeyDaycares.get(key);
      if (!set) perKeyDaycares.set(key, (set = new Set()));
      set.add(institute);
    }
  }

  const tools: ToolUsageRow[] = TOOL_KEYS.map((key) => ({
    toolKey: key,
    label: TOOLS[key].label,
    events: perKeyEvents.get(key) ?? 0,
    daycaresUsing: perKeyDaycares.get(key)?.size ?? 0,
    totalDaycares: active,
  }));
  const byEvents = [...tools].sort(
    (a, b) => b.events - a.events || a.label.localeCompare(b.label)
  );
  const top = byEvents.slice(0, 5);
  const neglected = byEvents.slice(-5).reverse();

  const named = await queryAll("SELECT id, name, active FROM institute ORDER BY name");
  const daycares: DaycareUsageRow[] = named
    .map((r) => {
      const id = String(r.id);
      const topEntry = instituteTopTool.get(id) ?? null;
      return {
        instituteId: id,
        name: String(r.name ?? ""),
        active: Number(r.active ?? 0) === 1,
        events: instituteEvents.get(id) ?? 0,
        topTool: topEntry?.tool ?? null,
        topToolEvents: topEntry?.n ?? 0,
      };
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) || b.events - a.events || a.name.localeCompare(b.name)
    );

  // Grand totals include platform-surface events (institute_id NULL), which
  // are excluded from the per-daycare breakdown by design.
  const totals = await queryGet(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN institute_id IS NULL THEN 1 ELSE 0 END), 0) AS platform_surface
     FROM tool_usage_event
     WHERE occurred_at >= ? AND occurred_at < ?`,
    tf.from,
    dayEndExclusive(tf.to)
  );

  return {
    from: tf.from,
    to: tf.to,
    presetDays: tf.presetDays,
    totalDaycares: total,
    activeDaycares: active,
    totalEvents: Number(totals?.total ?? 0),
    platformEvents: Number(totals?.platform_surface ?? 0),
    tools,
    top,
    neglected,
    daycares,
  };
}

// ---------------------------------------------------------------------------
// Historical backfill (estimates)
// ---------------------------------------------------------------------------

/**
 * Backfill rules: one SELECT per tool that yields `iid` (daycare id),
 * `n` (related historical rows) and `occurred_at` (newest related record).
 * Each rule emits ONE estimate row per ACTIVE daycare with related records,
 * labeled `{ "estimate": true, "historical_rows": n }` in metadata. The
 * simplest honest signal — "this daycare used this tool historically"
 * (adoption) — without inventing fake visit streams. dashboard and
 * report-center have no reasonable domain source and are never backfilled.
 */
export const BACKFILL_RULES: { toolKey: ToolKey; select: string }[] = [
  {
    toolKey: "newsfeed",
    select: `SELECT p.institute_id AS iid, COUNT(*) AS n, MAX(p.created_at) AS occurred_at
             FROM newsfeed_post p JOIN institute i ON i.id = p.institute_id AND i.active = 1
             GROUP BY p.institute_id`,
  },
  {
    toolKey: "events",
    select: `SELECT e.institute_id AS iid, COUNT(*) AS n, MAX(e.event_date) AS occurred_at
             FROM event e JOIN institute i ON i.id = e.institute_id AND i.active = 1
             GROUP BY e.institute_id`,
  },
  {
    toolKey: "calendar",
    select: `SELECT e.institute_id AS iid, COUNT(*) AS n, MAX(e.event_date) AS occurred_at
             FROM event e JOIN institute i ON i.id = e.institute_id AND i.active = 1
             GROUP BY e.institute_id`,
  },
  {
    toolKey: "children",
    select: `SELECT c.institute_id AS iid, COUNT(*) AS n, MAX(c.created_at) AS occurred_at
             FROM child c JOIN institute i ON i.id = c.institute_id AND i.active = 1
             GROUP BY c.institute_id`,
  },
  {
    toolKey: "attendance",
    select: `SELECT c.institute_id AS iid, COUNT(*) AS n, MAX(k.recorded_at) AS occurred_at
             FROM check_in k
             JOIN child c ON c.id = k.child_id
             JOIN institute i ON i.id = c.institute_id AND i.active = 1
             GROUP BY c.institute_id`,
  },
  {
    toolKey: "consents",
    select: `SELECT cr.institute_id AS iid, COUNT(*) AS n, MAX(cr.created_at) AS occurred_at
             FROM consent_request cr JOIN institute i ON i.id = cr.institute_id AND i.active = 1
             GROUP BY cr.institute_id`,
  },
  {
    toolKey: "learning",
    select: `SELECT h.institute_id AS iid, COUNT(*) AS n, MAX(h.created_at) AS occurred_at
             FROM homework h JOIN institute i ON i.id = h.institute_id AND i.active = 1
             GROUP BY h.institute_id`,
  },
  {
    toolKey: "staff",
    select: `SELECT s.institute_id AS iid, COUNT(*) AS n, MAX(s.created_at) AS occurred_at
             FROM staff s JOIN institute i ON i.id = s.institute_id AND i.active = 1
             GROUP BY s.institute_id`,
  },
  {
    toolKey: "messages",
    select: `SELECT m.institute_id AS iid, COUNT(*) AS n, MAX(m.created_at) AS occurred_at
             FROM message m JOIN institute i ON i.id = m.institute_id AND i.active = 1
             GROUP BY m.institute_id`,
  },
  {
    toolKey: "reports",
    select: `SELECT c.institute_id AS iid, COUNT(*) AS n, MAX(dr.created_at) AS occurred_at
             FROM daily_report dr
             JOIN child c ON c.id = dr.child_id
             JOIN institute i ON i.id = c.institute_id AND i.active = 1
             GROUP BY c.institute_id`,
  },
  {
    toolKey: "supplies",
    select: `SELECT s.institute_id AS iid, COUNT(*) AS n, MAX(s.created_at) AS occurred_at
             FROM supply_request s JOIN institute i ON i.id = s.institute_id AND i.active = 1
             GROUP BY s.institute_id`,
  },
  {
    toolKey: "rooms",
    select: `SELECT rm.institute_id AS iid, COUNT(*) AS n, MAX(rm.created_at) AS occurred_at
             FROM room rm JOIN institute i ON i.id = rm.institute_id AND i.active = 1
             GROUP BY rm.institute_id`,
  },
  {
    toolKey: "finance",
    select: `SELECT cb.institute_id AS iid, COUNT(*) AS n, MAX(cb.created_at) AS occurred_at
             FROM child_billing cb JOIN institute i ON i.id = cb.institute_id AND i.active = 1
             GROUP BY cb.institute_id`,
  },
  {
    toolKey: "forms",
    select: `SELECT t.institute_id AS iid, COUNT(*) AS n, MAX(r.created_at) AS occurred_at
             FROM form_response r
             JOIN form_template t ON t.id = r.form_id AND t.kind = 'form'
             JOIN institute i ON i.id = t.institute_id AND i.active = 1
             GROUP BY t.institute_id`,
  },
  {
    toolKey: "surveys",
    select: `SELECT t.institute_id AS iid, COUNT(*) AS n, MAX(t.created_at) AS occurred_at
             FROM form_template t JOIN institute i ON i.id = t.institute_id AND i.active = 1
             WHERE t.kind = 'survey'
             GROUP BY t.institute_id`,
  },
  {
    toolKey: "incidents",
    select: `SELECT ir.institute_id AS iid, COUNT(*) AS n, MAX(ir.created_at) AS occurred_at
             FROM incident_report ir JOIN institute i ON i.id = ir.institute_id AND i.active = 1
             GROUP BY ir.institute_id`,
  },
  {
    toolKey: "drive",
    select: `SELECT df.institute_id AS iid, COUNT(*) AS n, MAX(df.created_at) AS occurred_at
             FROM drive_file df JOIN institute i ON i.id = df.institute_id AND i.active = 1
             GROUP BY df.institute_id`,
  },
  {
    toolKey: "enhancements",
    select: `SELECT er.institute_id AS iid, COUNT(*) AS n, MAX(er.created_at) AS occurred_at
             FROM enhancement_request er JOIN institute i ON i.id = er.institute_id AND i.active = 1
             GROUP BY er.institute_id`,
  },
  {
    toolKey: "billing",
    select: `SELECT di.institute_id AS iid, COUNT(*) AS n, MAX(di.created_at) AS occurred_at
             FROM daycare_invoice di JOIN institute i ON i.id = di.institute_id AND i.active = 1
             GROUP BY di.institute_id`,
  },
];

/**
 * Idempotent historical backfill. Each rule inserts one estimate row per
 * (active daycare, tool) at the newest related record, skipping daycares that
 * already have a backfill row for the tool. Returns the number of rows
 * inserted (the page shows it, so the estimate is never invisible).
 */
export async function backfillToolUsageEstimates(): Promise<number> {
  let inserted = 0;
  for (const rule of BACKFILL_RULES) {
    const sql = `
      INSERT INTO tool_usage_event (id, institute_id, account_id, tool_key, source, metadata, occurred_at)
      SELECT 'bf-' || '${rule.toolKey}' || '-' || grouped.iid,
             grouped.iid,
             NULL,
             '${rule.toolKey}',
             'backfill',
             '{"estimate":true,"historical_rows":' || grouped.n || '}',
             grouped.occurred_at
      FROM (${rule.select}) grouped
      WHERE NOT EXISTS (
        SELECT 1 FROM tool_usage_event e
        WHERE e.institute_id = grouped.iid
          AND e.tool_key = '${rule.toolKey}'
          AND e.source = 'backfill'
      )`;
    try {
      const res = await queryRun(sql);
      // pg reports rowCount, better-sqlite3 reports changes
      inserted += res.rowCount ?? 0;
    } catch (err) {
      console.error("[tool-usage] backfillToolUsageEstimates failed", {
        toolKey: rule.toolKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return inserted;
}

/**
 * Tests / evidence helper: count recorded usage rows for a timeframe filter.
 */
export async function countToolUsageRows(where = ""): Promise<number> {
  const rows = await queryAll(`SELECT COUNT(*) AS n FROM tool_usage_event ${where}`);
  const r = rows[0] as { n?: unknown } | undefined;
  return Number(r?.n ?? 0);
}

/** Does NOT exist rows yet for one (daycare, tool, backfill)? (used in tests) */
export async function hasBackfillRow(
  instituteId: string,
  toolKey: ToolKey
): Promise<Row | undefined> {
  return queryGet(
    "SELECT * FROM tool_usage_event WHERE institute_id = ? AND tool_key = ? AND source = 'backfill'",
    instituteId,
    toolKey
  );
}
