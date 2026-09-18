import { requireSession } from "@/lib/require";
import { firstInstituteId } from "@/lib/helpers";

export const dynamic = "force-dynamic";

function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export async function GET(req: Request) {
  requireSession();
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "billing";
  const child = (url.searchParams.get("child") ?? "").toLowerCase();
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const instituteId = await firstInstituteId();
  const { queryAll } = await import("@/lib/db");
  let rows: Record<string, unknown>[] = [];
  let name = `${type}-export.csv`;

  if (type === "billing") {
    rows = (await queryAll(
      `SELECT cb.*, c.first_name, c.last_name FROM child_billing cb JOIN child c ON c.id = cb.child_id WHERE cb.institute_id = ?`,
      instituteId
    )) as Record<string, unknown>[];
    if (child) rows = rows.filter((r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(child));
    if (status) rows = rows.filter((r) => String(r.status) === status);
    if (from) rows = rows.filter((r) => String(r.due_date ?? r.created_at ?? "") >= from);
    if (to) rows = rows.filter((r) => String(r.due_date ?? r.created_at ?? "") <= to);
    name = "billing-export.csv";
  } else if (type === "attendance") {
    const day = url.searchParams.get("day") ?? new Date().toISOString().slice(0, 10);
    const { attendanceOn } = await import("@/lib/store");
    rows = ((await attendanceOn(instituteId, day)) as Record<string, unknown>[]).map((r) => ({
      child: `${r.first_name} ${r.last_name}`,
      room: r.room_name ?? "",
      status: r.last_event ?? "absent",
      checked_in: r.checked_in_at ?? "",
      checked_out: r.checked_out_at ?? "",
    }));
    name = `attendance-${day}.csv`;
  } else if (type === "children") {
    const gender = (url.searchParams.get("gender") ?? "").toLowerCase();
    const maxAge = Number(url.searchParams.get("maxAge") ?? "") || null;
    const { listChildren } = await import("@/lib/store");
    let kids = ((await listChildren(instituteId)) as Record<string, unknown>[]);
    if (child) kids = kids.filter((k) => `${k.first_name} ${k.last_name}`.toLowerCase().includes(child));
    if (gender) kids = kids.filter((k) => String((k as any).gender ?? "").toLowerCase() === gender);
    if (maxAge !== null) {
      kids = kids.filter((k) => {
        const dob = (k as any).dob as string | undefined;
        if (!dob) return false;
        const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000);
        return age < maxAge;
      });
    }
    rows = kids.map((k) => ({
      name: `${k.first_name} ${k.last_name}`,
      room: (k as any).room_name ?? "",
      dob: (k as any).dob ?? "",
      gender: (k as any).gender ?? "",
      allergies: (k as any).allergies ?? "",
    }));
    name = "children-smart-list.csv";
  }

  return new Response(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
