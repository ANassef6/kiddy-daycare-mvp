import Link from "next/link";
import { cookies, headers } from "next/headers";
import { LANG_COOKIE, getDictionary, localeOf, tr, type Locale } from "@/lib/i18n";
import { brandNameForTitle } from "@/lib/theme";

// KID-1178/F-06: uniform throttle landing page. Server actions whose form
// contract is redirect-only (messaging, uploads, invite mail sends, the public
// contact form) cannot return an error banner, so when the per-account /
// per-IP abuse budget refuses the request they bounce here instead of
// silently no-opping. The wording is the same localized key the error-return
// auth surfaces use (security.rateLimited), resolved from the kiddy_lang
// cookie exactly like the login page (KID-368 precedence).
export const dynamic = "force-dynamic";

export default async function RateLimitedPage() {
  const cookieStore = await cookies();
  const locale: Locale = localeOf(cookieStore.get(LANG_COOKIE)?.value);
  const dict = getDictionary(locale);
  const t = (key: string) => tr(dict, key);

  const backUrl = (await headers()).get("referer") ?? "/";
  let backPath = "/";
  try {
    const parsed = new URL(backUrl);
    const host = (await headers()).get("host");
    const sameOrigin = !parsed.host || (host ? parsed.host === host : true);
    if (sameOrigin) backPath = parsed.pathname + parsed.search;
  } catch {
    // keep the safe default "/"
  }

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 80 }}>
      <div className="card">
        <h1>{t("security.rateLimited")}</h1>
        <p className="subtitle">
          {locale === "ar"
            ? "وصلتَ إلى حد إرسال الطلبات المسموح به لحظيًا لحماية المركز من الإساءة. حاول مرة أخرى بعد قليل."
            : "You've reached a temporary request limit that protects the platform from abuse. Try again in a little while."}
        </p>
        <Link className="btn" href={backPath}>
          {locale === "ar" ? "رجوع" : "Go back"}
        </Link>
      </div>
    </div>
  );
}
