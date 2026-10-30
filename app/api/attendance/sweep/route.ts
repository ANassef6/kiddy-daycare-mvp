import { NextResponse } from "next/server";
import { queryAll } from "@/lib/db";
import { runAutoCheckoutSweep } from "@/lib/store";

// KID-55 item 3 / KID-58: externally-triggerable auto check-out sweep. The
// sweep also runs automatically whenever the attendance surfaces load, but a
// scheduler/cron can hit this route to run it on its own cadence.
//
// The mutation is idempotent and only ever writes system check-outs for
// people still checked-in 3h after closing, so an unauthenticated trigger is
// safe for this MVP.
//
// KID-206: with more than one centre this route must sweep EVERY institute —
// the old "SELECT id FROM institute LIMIT 1" pinned the first-created daycare
// and left centre #2+ un-swept, each with its own working-hours cutoff. Each
// centre's cutoff applies to its own rows inside runAutoCheckoutSweep.
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await queryAll("SELECT id FROM institute");
  let children = 0;
  let staff = 0;
  for (const row of rows) {
    const result = await runAutoCheckoutSweep(String(row.id));
    children += result.children.length;
    staff += result.staff.length;
  }
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, children: 0, staff: 0, reason: "no institute" });
  }
  return NextResponse.json({ ok: true, children, staff });
}

export const POST = GET;