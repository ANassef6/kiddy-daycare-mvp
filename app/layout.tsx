import type { Metadata } from "next";
import "./globals.css";
import { getBranding } from "@/lib/theme";

export const metadata: Metadata = {
  title: {
    default: "Kiddy — childcare, in your pocket",
    template: "%s | Kiddy",
  },
  description: "Check-in, check-out, daily reports, and the newsfeed for Canadian daycares.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let theme = "";
  let brand = "Kiddy";
  try {
    const b = await getBranding();
    theme = [
      `--brand-primary: ${b.primaryColor};`,
      `--brand-accent: ${b.accentColor};`,
      `--brand-font: '${b.font}', system-ui, sans-serif;`,
    ].join("\n");
    brand = b.name;
  } catch {
    // never block render on DB availability
  }

  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${theme}}` }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}