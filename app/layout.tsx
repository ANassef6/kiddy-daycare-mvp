import type { Metadata } from "next";
import "./globals.css";
import { getFirstInstitute, brandingFromInstitute, themeCss } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Kiddy — childcare, in your pocket",
  description: "Check-in, check-out, daily reports, and the newsfeed for Canadian daycares.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let theme = "";
  let brand = "Kiddy";
  try {
    const { ensureSeeded } = await import("@/lib/bootstrap");
    await ensureSeeded();
    const first = await getFirstInstitute();
    if (first) {
      const b = brandingFromInstitute(first);
      theme = themeCss(b);
      brand = b.name;
    }
  } catch {
    // never block render on DB availability
  }

  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${theme}}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}