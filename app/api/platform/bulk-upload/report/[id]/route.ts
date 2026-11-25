// KID-2478: download one bulk-upload report as CSV. Operator-only, like the
// upload itself. The report row is tenant-scoped by the upload action; the
// operator may read any daycare's run because /platform is cross-tenant by
// design.
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { sessionFromHeaders } from "@/lib/auth";
import { isPlatformOperator } from "@/lib/platform";
import { bulkReportCsv, getBulkUploadReport } from "@/lib/bulk-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const session = sessionFromHeaders(await headers());
  if (!session || !isPlatformOperator(session.role, session.email)) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Platform operator access is required." } },
      { status: 403 }
    );
  }
  const { id } = await props.params;
  const report = await getBulkUploadReport(id);
  if (!report) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Report not found." } },
      { status: 404 }
    );
  }
  const csv = bulkReportCsv(report);
  const safeName = report.fileName.replace(/\.xlsx$/i, "") || "bulk-upload";
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-report.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
