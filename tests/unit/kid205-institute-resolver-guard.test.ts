// KID-205: every composer send on production redirected with
// error=norecipients because all server actions pinned "the institute" with a
// bare heap-first `LIMIT 1` — and the production table carries a stray third
// institute row, so the pin could match NO sender's centre. The session-aware
// tenant resolver (lib/tenant.ts) and the deterministic
// `ORDER BY created_at` fallback are the fix; this suite pins both halves:
//
//   1. A static guard: no runtime path may issue an institute pick that lacks
//      an ORDER BY before its LIMIT — the exact failure mode KID-205 proved
//      against production. The only permitted occurrences are the two
//      single-institute-guarded backfills (the 0020 mirror and the 0020
//      migration itself), and even they must keep their count guard.
//   2. Behavior: with stray institute rows present (realistic production
//      shape), the fallback is deterministic by creation date, staff/owner
//      tenancy resolves their OWN daycare, and composer sends whose channel is
//      provably in the sender's scope SUCCEED instead of returning
//      error=norecipients.
//   3. The cron-triggered attendance sweep sweeps EVERY daycare in the
//      deterministic order — not whichever row the engine surfaced first.

process.env.TZ = "UTC";

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { queryAll, queryRun, type Row } from "@/lib/db";
import { fallbackInstituteId } from "@/lib/tenant";
import { primaryInstituteIdForAccount } from "@/lib/store";
import { createAccount, createSessionToken } from "@/lib/auth";
import { mustGet, seedFixture } from "../helpers";
import * as store from "@/lib/store";

// The one permitted shape: a bare single-row pick that is guarded by
// "(SELECT COUNT(*) FROM institute) = 1" in the same statement — deterministic
// because it only ever fires when exactly one row exists. The 0020 SQLite
// mirror carries the same ORDER BY as the fallback, so the applied migration
// below is the only remaining bare pick, and it must keep its count guard.
// Anything else bare is a KID-205-shaped bug that must fail this suite.
const GUARDED_SINGLE_ROW_PICKS = ["supabase/migrations/0020_staff_login_link.sql"] as const;

type SessionCarrier = { __kid205Session?: { value: string } };

function sessionCookie(): { value: string } | undefined {
  return (globalThis as unknown as SessionCarrier).__kid205Session;
}

function asSession(account: Row): void {
  (globalThis as unknown as SessionCarrier).__kid205Session = {
    value: createSessionToken({
      accountId: String(account.id),
      role: String(account.role),
      email: String(account.email),
      accountConfirmed: true,
    } as never),
  };
}

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === "kiddy_sess" ? (globalThis as unknown as SessionCarrier).__kid205Session : undefined),
  }),
  headers: () => {
    const sess = (globalThis as unknown as SessionCarrier).__kid205Session;
    return new Headers(sess?.value ? { cookie: `kiddy_sess=${sess.value}` } : {});
  },
}));

async function redirectTargetOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
  throw new Error("expected the action to redirect");
}

function queryParam(target: string, name: string): string {
  return String(new URLSearchParams(target.split("?")[1] ?? "").get(name) ?? "");
}

let sunshineId: string;
let strayIds: string[];

// Production shape: one real centre PLUS stray institute rows that a heap-first
// pin can surface. Inserted AFTER the seed, with created_at values out of
// physical-insert order, so every "first row wins" shortcut fails.
async function addStrayInstitute(name: string, createdAt: string): Promise<string> {
  const id = `inst-${name.toLowerCase().replace(/\s+/g, "-")}`;
  await queryRun("INSERT INTO institute (id, name, created_at) VALUES (?, ?, ?)", id, name, createdAt);
  return id;
}

function runtimeSources(): string[] {
  const roots = ["lib", "app", "components", "supabase"];
  const exts = /\.(ts|tsx|mjs|sql|js)$/i;
  const skip = new Set(["node_modules", ".next", ".git", "coverage"]);
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(process.cwd(), rel), { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const relChild = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(relChild);
      else if (exts.test(entry.name)) out.push(relChild);
    }
  };
  for (const root of roots) {
    if (!fs.existsSync(path.join(process.cwd(), root))) continue;
    walk(root);
  }
  return out;
}

// A hit is bare when the text between `FROM institute` and the next `LIMIT`
// (within a small window so we stay inside the same subquery) contains no
// ORDER BY. `ORDER BY created_at LIMIT 1` — the sanctioned fallback — passes.
function bareInstitutePickHits(content: string): Array<{ line: number; statement: string }> {
  const hits: Array<{ line: number; statement: string }> = [];
  const re = /FROM\s+institute\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    // A `SELECT COUNT(*) FROM institute ...` is an existence count and can
    // never resolve "the institute"; only single-row picks (id/row selects)
    // are the pinned shape.
    const before = content.slice(Math.max(0, m.index - 30), m.index);
    if (/COUNT\s*\(\s*\*\s*\)\s*$/.test(before)) continue;
    const window = content.slice(m.index, m.index + 220);
    const limit = /\bLIMIT\b/i.exec(window);
    if (!limit) continue;
    if (/ORDER\s+BY/i.test(window.slice(0, limit.index))) continue;
    const line = content.slice(0, m.index).split("\n").length;
    hits.push({ line, statement: window.slice(0, limit.index + 20).replace(/\s+/g, " ") });
  }
  return hits;
}

describe("KID-205 static guard: no bare institute picks", () => {
  it("scans runtime sources for LIMIT-without-ORDER-BY institute picks", () => {
    const offenders: string[] = [];
    for (const file of runtimeSources()) {
      if (GUARDED_SINGLE_ROW_PICKS.includes(file as (typeof GUARDED_SINGLE_ROW_PICKS)[number])) continue;
      for (const hit of bareInstitutePickHits(fs.readFileSync(path.join(process.cwd(), file), "utf8"))) {
        offenders.push(`${file}:${hit.line}  ${hit.statement}`);
      }
    }
    expect(
      offenders,
      "an institute pick resolved by bare LIMIT (no ORDER BY) is nondeterministic the moment a second daycare exists — resolve through lib/tenant.ts (session → own tenancy, deterministic fallback) instead"
    ).toEqual([]);
  });

  it("the permitted bare pick is the count-guarded single-stage backfill", () => {
    for (const file of GUARDED_SINGLE_ROW_PICKS) {
      const content = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(bareInstitutePickHits(content)).toHaveLength(1);
      // The safety bar for the permit: the pick may only run when the table
      // holds exactly one row, so the result is deterministic from the data.
      expect(content).toContain("(SELECT COUNT(*) FROM institute) = 1");
    }
  });
});

beforeEach(async () => {
  await seedFixture();
  sunshineId = String((await mustGet("SELECT id FROM institute WHERE name = 'Sunshine Daycare'")).id);
  // A heap-first pin would land on one of these instead of Sunshine exactly the
  // way production proved (KID-205 evidence: both known centres rejected).
  strayIds = [
    await addStrayInstitute("Stray Institute Zeta", "2099-01-01 00:00:00"),
    await addStrayInstitute("Stray Institute Alpha", "2090-01-01 00:00:00"),
  ];
});

describe("KID-205 institute resolver", () => {
  it("the logged-out fallback is deterministic: earliest created_at, never the first physical row", async () => {
    // Physical order: Sunshine (real now), Zeta (2099), Alpha (2090). Rewind
    // Sunshine's created_at between them so created_at order equals neither
    // the physical order nor the first-inserted row.
    await queryRun("UPDATE institute SET created_at = ? WHERE id = ?", "2095-01-01 00:00:00", sunshineId);
    expect(await fallbackInstituteId()).toBe(strayIds[1]); // Alpha (2090) < Sunshine (2095) < Zeta (2099)
    expect(await fallbackInstituteId()).toBe(await fallbackInstituteId()); // stable across reads
    await queryRun("UPDATE institute SET created_at = ? WHERE id = ?", "2001-01-01 00:00:00", sunshineId);
    expect(await fallbackInstituteId()).toBe(sunshineId);
  });

  it("tenancy beats the fallback: Sunshine's linked owner resolves Sunshine with strays present", async () => {
    const owner = await mustGet("SELECT id FROM account WHERE email = 'admin@sunshinedaycare.test'");
    expect(await primaryInstituteIdForAccount(String(owner.id))).toBe(sunshineId);
  });
});

describe("KID-205 composer sends under a stray institute row", () => {
  const ownerRow = () => mustGet("SELECT * FROM account WHERE email = 'admin@sunshinedaycare.test'");

  it("owner: an in-scope channel collects its recipients and the send lands (no error=norecipients)", async () => {
    const roomToddlers = String(
      (await mustGet("SELECT id FROM room WHERE institute_id = ? AND name = 'Toddlers'", sunshineId)).id
    );
    asSession(await ownerRow());
    const grace = await mustGet("SELECT id FROM account WHERE email = 'parent@example.test'");

    const { sendComposerAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("body", "KID-205 regression");
    form.set("channels", roomToddlers);
    form.set(`audience:${roomToddlers}`, "whole");
    form.set("groupMode", "on");
    const target = await redirectTargetOf(() => sendComposerAction(form));

    expect(target).not.toContain("error=norecipients");
    expect(target).toContain("thread=");
    const threadId = queryParam(target, "thread");
    const thread = await mustGet("SELECT * FROM message_thread WHERE id = ?", threadId);
    expect(String(thread.institute_id)).toBe(sunshineId); // stamped with the sender's centre, not a stray
    const recipients = await queryAll("SELECT account_id FROM message_thread_participant WHERE thread_id = ?", threadId);
    expect(recipients.some((r: Row) => String(r.account_id) === String(grace.id))).toBe(true);
    const stamped = await queryAll("SELECT DISTINCT institute_id FROM message WHERE thread_id = ?", threadId);
    expect(stamped.map((r: Row) => String(r.institute_id))).toEqual([sunshineId]);
  });

  it("staff: a carer of the room can send to their own classroom with strays present", async () => {
    const roomToddlers = String(
      (await mustGet("SELECT id FROM room WHERE institute_id = ? AND name = 'Toddlers'", sunshineId)).id
    );
    const s = await store.createStaff({ instituteId: sunshineId, fullName: "Sofia Kid205", role: "carer", roomIds: [roomToddlers] });
    await createAccount({ email: "sofia-kid205@test", password: "x", fullName: "Sofia Kid205", role: "staff" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(s.id), String((await mustGet("SELECT id FROM account WHERE email = 'sofia-kid205@test'")).id));
    asSession(await mustGet("SELECT * FROM account WHERE email = 'sofia-kid205@test'"));
    const grace = await mustGet("SELECT id FROM account WHERE email = 'parent@example.test'");

    const { sendComposerAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("body", "Sofia KID-205 send");
    form.set("channels", roomToddlers);
    form.set(`audience:${roomToddlers}`, "whole");
    form.set("groupMode", "on");
    const target = await redirectTargetOf(() => sendComposerAction(form));

    expect(target).not.toContain("error=norecipients");
    expect(target).toContain("thread=");
    const recipients = await queryAll(
      "SELECT account_id FROM message_thread_participant WHERE thread_id = ?",
      queryParam(target, "thread")
    );
    expect(recipients.some((r: Row) => String(r.account_id) === String(grace.id))).toBe(true);
  });
});

describe("KID-205 attendance sweep route", () => {
  it("sweeps every institute in deterministic order, not one heap-picked row", async () => {
    const maple = await store.seedInstitute({ name: "Maple Grove Kid205" });
    const mapleId = String(maple.id);
    for (const iid of [sunshineId, mapleId]) {
      await store.saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    }
    const toddler = String((await mustGet("SELECT id FROM room WHERE institute_id = ? AND name = 'Toddlers'", sunshineId)).id);
    const kidA = await store.createChild({ instituteId: sunshineId, firstName: "Ana", lastName: "Sweep", roomId: toddler });
    const kidB = await store.createChild({ instituteId: mapleId, firstName: "Bilal", lastName: "Sweep" });
    const actor = await store.systemAccountId();
    const inAt = new Date(2026, 0, 5, 8, 0, 0).toISOString();
    for (const kid of [kidA, kidB]) {
      await queryRun(
        "INSERT INTO check_in (id, child_id, account_id, type, is_edit, recorded_at) VALUES (?, ?, ?, 'in', 0, ?)",
        `ci-kid205-${String(kid.id)}`,
        String(kid.id),
        actor,
        inAt
      );
    }

    // Jan 5 2026 is a Monday; 22:00 is past closing (18:00) + 3h grace — BUT
    // only for the daycares with Monday hours; the strays have no config and
    // contribute nothing, exactly as before.
    const now = new Date(2026, 0, 5, 22, 0, 0);
    vi.useFakeTimers().setSystemTime(now);
    try {
      const { GET } = await import("@/app/api/attendance/sweep/route");
      const response = await GET();
      const body = (await response.json()) as {
        ok: boolean;
        institutes: number;
        children: number;
        staff: number;
        perInstitute: Array<{ instituteId: string; children: number }>;
      };
      expect(body.ok).toBe(true);
      expect(body.institutes).toBe(Number((await mustGet("SELECT COUNT(*) c FROM institute"))!.c));
      expect(body.children).toBe(2);
      expect(body.staff).toBe(0);
      expect(body.perInstitute.map((p) => p.instituteId)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }

    for (const kid of [kidA, kidB]) {
      const outs = await queryAll("SELECT * FROM check_in WHERE child_id = ? AND type = 'out'", String(kid.id));
      expect(outs).toHaveLength(1);
      const outRow = outs[0] as Row;
      expect(String(outRow.recorded_at)).toBe(now.toISOString()); // swept with the frozen 'now'
      expect(String(outRow.account_id)).toBe(actor); // system actor
    }
  });
});
