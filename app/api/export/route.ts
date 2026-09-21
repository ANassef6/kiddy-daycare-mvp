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
  const session = requireSession();
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "billing";
  const child = (url.searchParams.get("child") ?? "").toLowerCase();
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const instituteId = await firstInstituteId();
  let rows: Record<string, unknown>[] = [];
  let name = `${type}-export.csv`;

  if (type === "billing") {
    const { listInstituteBilling } = await import("@/lib/store");
    rows = ((await listInstituteBilling(instituteId)) as Record<string, unknown>[]).map((r) => ({
      reference: r.reference ?? r.id,
      child: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
      payer: r.payer_name ?? "",
      payer_phone: r.payer_phone ?? "",
      period: r.period ?? "",
      due_date: r.due_date ?? "",
      currency: r.currency ?? "AED",
      status: r.status ?? "draft",
      discount: r.discount ?? "",
      total: r.amount ?? 0,
    }));
    if (child) rows = rows.filter((r) => String(r.child).toLowerCase().includes(child));
    if (status) rows = rows.filter((r) => String(r.status) === status);
    if (from) rows = rows.filter((r) => String(r.due_date ?? "") >= from);
    if (to) rows = rows.filter((r) => String(r.due_date ?? "") <= to);
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
    const child = (url.searchParams.get("child") ?? "").toLowerCase();
    const roomId = (url.searchParams.get("roomId") ?? "").toLowerCase();
    const enrolledFrom = url.searchParams.get("enrolledFrom") ?? "";
    const keepCols = (url.searchParams.get("cols") ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const { listChildren } = await import("@/lib/store");
    let kids = ((await listChildren(instituteId, { accountId: session.accountId })) as Record<string, unknown>[]);
    if (child) kids = kids.filter((k) => `${k.first_name} ${k.last_name}`.toLowerCase().includes(child));
    if (gender) kids = kids.filter((k) => String((k as any).gender ?? "").toLowerCase() === gender);
    if (roomId) kids = kids.filter((k) => String((k as any).room_id ?? "").toLowerCase() === roomId);
    if (enrolledFrom) {
      kids = kids.filter((k) => {
        const ea = (k as any).enrolled_at ? String((k as any).enrolled_at).slice(0, 10) : "";
        return ea >= enrolledFrom;
      });
    }
    if (maxAge !== null) {
      kids = kids.filter((k) => {
        const dob = (k as any).dob as string | undefined;
        if (!dob) return false;
        const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000);
        return age < maxAge;
      });
    }
    const COL_FNS: Record<string, (k: any) => unknown> = {
      name: (k) => `${k.first_name} ${k.last_name}`.trim(),
      room: (k) => k.room_name ?? "",
      dob: (k) => k.dob ?? "",
      age: (k) => (k.dob ? Math.floor((Date.now() - new Date(k.dob).getTime()) / (365.25 * 24 * 3600 * 1000)) : ""),
      gender: (k) => k.gender ?? "",
      allergies: (k) => k.allergies ?? "",
    };
    const columns = keepCols.length > 0 ? keepCols.filter((c) => c in COL_FNS) : Object.keys(COL_FNS);
    rows = kids.map((k) => Object.fromEntries(columns.map((c) => [c, COL_FNS[c](k)])));
    name = "children-smart-list.csv";
  }

  return new Response(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
