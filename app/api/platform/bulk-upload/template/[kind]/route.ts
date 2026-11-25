// KID-2478: download the approved bulk-upload template. Operator-only — the
// same session + allowlist check as every /platform surface. Nothing is read
// from the database here; the byte content is the template the founder
// reviewed.
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { sessionFromHeaders } from "@/lib/auth";
import { isPlatformOperator } from "@/lib/platform";
import { BULK_KINDS, BULK_TEMPLATE_FILENAMES, buildBulkTemplate, type BulkKind } from "@/lib/bulk-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  props: { params: Promise<{ kind: string }> }
) {
  const session = sessionFromHeaders(await headers());
  if (!session || !isPlatformOperator(session.role, session.email)) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Platform operator access is required." } },
      { status: 403 }
    );
  }
  const { kind } = await props.params;
  if (!BULK_KINDS.includes(kind as BulkKind)) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Unknown template." } },
      { status: 404 }
    );
  }
  const buffer = await buildBulkTemplate(kind as BulkKind);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${BULK_TEMPLATE_FILENAMES[kind as BulkKind]}"`,
      "Cache-Control": "no-store",
    },
  });
}
