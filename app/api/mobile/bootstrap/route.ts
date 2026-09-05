import { NextRequest, NextResponse } from "next/server";
import { requireMobileSession, brandingPayload, familiesPayload } from "@/lib/mobile-api";
import { getAccount } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Everything the mobile home screen needs in one call: account identity,
// white-label branding (theme tokens), and the parent's children with today's
// check-in/out status and daily report.
export async function GET(req: NextRequest) {
  const session = await requireMobileSession(req);
  if (session instanceof NextResponse) return session;

  const [branding, children, account] = await Promise.all([
    brandingPayload(),
    familiesPayload(session.accountId),
    getAccount(session.accountId),
  ]);

  return NextResponse.json({
    account: {
      id: account?.id,
      email: account?.email,
      role: account?.role,
      fullName: account?.full_name,
    },
    branding,
    children,
  });
}