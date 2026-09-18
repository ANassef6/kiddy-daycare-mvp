import { NextResponse } from "next/server";

// TEMPORARY KID-47 diagnostic: captures the real server-side error behind the
// /portal/learning 500. Token-gated, returns only step outcomes + row counts
// (no PII). REMOVED before the final prod deploy.
export const dynamic = "force-dynamic";

const TOKEN = "kid47-dbg-7f3a9c2e";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const steps: Record<string, unknown> = {};
  try {
    await import("@/lib/curriculum");
    steps.importCurriculum = "ok";
  } catch (e: unknown) {
    steps.importCurriculum = "THROW: " + ((e as Error)?.message ?? String(e));
  }
  try {
    const { ensureSchema, queryGet } = await import("@/lib/db");
    await ensureSchema();
    steps.ensureSchema = "ok";
    const c = await queryGet("SELECT COUNT(*) AS c FROM curriculum_area");
    steps.countArea = { c: c?.c ?? null, typeofC: typeof c?.c };
  } catch (e: unknown) {
    steps.ensureSchemaCount = "THROW: " + ((e as Error)?.message ?? String(e));
  }
  try {
    const { listCurriculumAreas } = await import("@/lib/curriculum");
    const a = await listCurriculumAreas();
    steps.listAreas = { ok: true, n: a.length };
  } catch (e: unknown) {
    steps.listAreas = "THROW: " + ((e as Error)?.message ?? String(e));
  }
  try {
    const { curriculumTree } = await import("@/lib/curriculum");
    const t = await curriculumTree();
    steps.tree = { ok: true, areas: t.length };
  } catch (e: unknown) {
    steps.tree = "THROW: " + ((e as Error)?.message ?? String(e));
  }
  try {
    const { ensureCurriculumSeeded } = await import("@/lib/curriculum");
    await ensureCurriculumSeeded();
    steps.seeded = "ok";
  } catch (e: unknown) {
    steps.seeded = "THROW: " + ((e as Error)?.message ?? String(e));
  }
  return NextResponse.json(steps);
}
