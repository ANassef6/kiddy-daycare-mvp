import type { Metadata } from "next";
import "./globals.css";
import { getInstitute } from "@/lib/store";
import { brandingFromInstitute, themeCss } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Kiddy — childcare, in your pocket",
  description: "Check-in, check-out, daily reports, and the newsfeed for Canadian daycares.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  let theme = "";
  let brand = "Kiddy";
  try {
    const { ensureSeeded } = require("@/lib/bootstrap");
    ensureSeeded();
    const first = getFirstInstitute();
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

function getFirstInstitute() {
  const { getDb } = require("@/lib/db");
  const db = getDb();
  const row = db.prepare("SELECT id FROM institute ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  return row ? getInstitute(row.id) : undefined;
}
