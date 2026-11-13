// KID-199.3r (KID-212): the neutral error page for a hostname under the
// wildcard that no daycare claims. No tenant data, no first-institute
// fallback, no branding — just the platform name and a way back.
// KID-2400: the copy resolves from the lib/i18n dictionary with the SAME
// locale precedence as /login — the kiddy_lang cookie wins; there is no
// session on this page, so English is the fallback (hence force-dynamic,
// so cookies() can be read).
import Link from "next/link";
import { cookies } from "next/headers";
import { LANG_COOKIE, getDictionary, localeOf, tr, type Locale } from "@/lib/i18n";
import { SITE_BRAND } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function UnknownDaycarePage() {
  const cookieStore = await cookies();
  const cookieLang = cookieStore.get(LANG_COOKIE)?.value;
  const locale: Locale = localeOf(cookieLang);
  const dict = getDictionary(locale);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, `unknownDaycare.${key}`, vars);

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 100, textAlign: "center" }}>
      <p className="brand" style={{ marginBottom: 24 }}>{SITE_BRAND}</p>
      <h1 className="title">{t("title")}</h1>
      <p className="subtitle" style={{ marginTop: 8 }}>
        {t("subtitle", { brand: SITE_BRAND })} {t("tagline")}.
      </p>
      <p className="small muted" style={{ marginTop: 8 }}>
        {t("hint")}
      </p>
      <p style={{ marginTop: 24 }}>
        <Link className="btn btn-primary" href="/">{t("mainSiteBtn")}</Link>
      </p>
    </div>
  );
}
