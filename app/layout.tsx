import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { getBranding } from "@/lib/theme";
import { readSessionFromCookieValue } from "@/lib/auth";
import { ensureSeeded } from "@/lib/bootstrap";
import { LANG_COOKIE, dirFor, localeOf, type Locale } from "@/lib/i18n";
import ChatwootWidget from "@/components/ChatwootWidget";

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
    const session = readSessionFromCookieValue(cookieStore.get("kiddy_sess")?.value ?? null);
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
  // KID-216: the lazy bootstrap (schema + demo seed + platform operator for the
  // PLATFORM_ADMIN_EMAIL allowlist) was never wired to any request path, so an
  // unmanaged deployment could never mint its operator account. Await it once
  // on the first render of every warm instance; it self-skips afterwards and
  // must never block the render on failure.
  try {
    await ensureSeeded();
  } catch (err) {
    console.error("Bootstrap failed at layout render:", err);
  }

  let theme = "";
  // KID-256: the meta/head branding is the HOST's brand — on
  // sunshine.<apex> the browser chrome, apple-touch icon, and manifest
  // link all name the daycare; apex/legacy hosts keep generic Kiddy. The
  // defaults below are also the no-DB fallback.
  let metaBrand = { name: "Kiddy", primaryColor: "#3B82F6", logoUrl: null as string | null };
  try {
    const b = await getBranding();
    metaBrand = { name: b.name, primaryColor: b.primaryColor, logoUrl: b.logoUrl };
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
        <meta name="theme-color" content={metaBrand.primaryColor} />
        {/* KID-256: manifest + generated fallback icon; on a daycare
            subdomain the manifest is that daycare's brand. Relative hrefs so
            the per-origin manifest is picked up on every host. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href={metaBrand.logoUrl ?? "/brand-icon.svg"} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          {locale === "ar" ? "تخطَّ إلى المحتوى" : "Skip to content"}
        </a>
        {/* #1: logo URL available as data attribute for client components */}
        <div data-brand={metaBrand.name} data-logo={metaBrand.logoUrl ?? ""} style={{ display: "none" }} />
        {children}
        {/* KID-306: env-configured Chatwoot support widget (bottom-right,
            Chatwoot default). Renders nothing (no request, no bubble) unless
            both NEXT_PUBLIC_CHATWOOT_* vars are set. Client boundary lives
            inside the component; the server layout above is untouched. */}
        <ChatwootWidget />
      </body>
    </html>
  );
}