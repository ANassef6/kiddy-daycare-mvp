import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { getBranding } from "@/lib/theme";
import { SITE_BRAND } from "@/lib/site";
import { readSessionFromCookie } from "@/lib/auth";
import { LANG_COOKIE, dirFor, localeOf, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: {
    default: "Kiddy — childcare, in your pocket",
    template: "%s | Kiddy",
  },
  description: "Check-in, check-out, daily reports, and the newsfeed for Egyptian daycares.",
};

export const dynamic = "force-dynamic";

// Resolve the active locale for the request: the lang cookie (set when the
// user picks a language) wins; otherwise fall back to the account preference.
async function resolveLocale(): Promise<Locale> {
  const cookieStore = cookies();
  const langCookie = cookieStore.get(LANG_COOKIE)?.value;
  if (langCookie === "en" || langCookie === "ar") return langCookie;
  try {
    const session = readSessionFromCookie(cookieStore.get("kiddy_sess")?.value ?? null);
    if (session?.accountId) {
      const { getAccount } = await import("@/lib/auth");
      const account = await getAccount(session.accountId);
      if (account?.language) return localeOf(account.language);
    }
  } catch {
    // never block render on DB availability
  }
  return "en" as Locale;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let theme = "";
  let brand = SITE_BRAND;
  let logoUrl: string | null = null;
  try {
    const b = await getBranding();
    theme = [
      `--brand-primary: ${b.primaryColor};`,
      `--brand-accent: ${b.accentColor};`,
      `--brand-font: '${b.font}', system-ui, sans-serif;`,
    ].join("\n");
  } catch {
    // never block render on DB availability
  }

  const locale = await resolveLocale();

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${theme}}` }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          {locale === "ar" ? "تخطَّ إلى المحتوى" : "Skip to content"}
        </a>
        {/* #1: logo URL available as data attribute for client components */}
        <div data-brand={brand} data-logo={logoUrl ?? ""} style={{ display: "none" }} />
        {children}
      </body>
    </html>
  );
}