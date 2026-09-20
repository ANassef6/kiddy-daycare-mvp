import { NextResponse } from "next/server";
import { queryGet } from "@/lib/db";
import { runAutoCheckoutSweep } from "@/lib/store";

// KID-55 item 3 / KID-58: externally-triggerable auto check-out sweep. The
// sweep also runs automatically whenever the attendance surfaces load, but a
// scheduler/cron can hit this route to run it on its own cadence.
//
// The mutation is idempotent and only ever writes system check-outs for
// people still checked-in 3h after closing, so an unauthenticated trigger is
// safe for this MVP.
export const dynamic = "force-dynamic";

export async function GET() {
  const institute = await queryGet("SELECT id FROM institute LIMIT 1");
  if (!institute) {
    return NextResponse.json({ ok: true, children: 0, staff: 0, reason: "no institute" });
  }
  const result = await runAutoCheckoutSweep(String(institute.id));
  return NextResponse.json({ ok: true, ...result });
}

export const POST = GET;