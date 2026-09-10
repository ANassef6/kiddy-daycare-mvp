import { NextResponse } from "next/server";
import { getBranding } from "@/lib/theme";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const b = await getBranding();
    return NextResponse.json({ name: b.name, logoUrl: b.logoUrl, brandImageUrl: b.brandImageUrl, primaryColor: b.primaryColor, accentColor: b.accentColor, font: b.font });
  } catch {
    return NextResponse.json({ name: "Kiddy", logoUrl: null });
  }
}
