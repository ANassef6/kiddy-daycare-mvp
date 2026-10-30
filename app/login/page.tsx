import Link from "next/link";
import { cookies } from "next/headers";
import { LANG_COOKIE, getDictionary, localeOf, tenancyDisabledMessage, tr, type Locale, type TenancyDisabledReason } from "@/lib/i18n";
import LoginBrand from "./login-brand";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

// KID-368 (DEF-004): the login screen — the first screen AR-facing parents
// see — was hardcoded English. Every string is resolved server-side from the
// lib/i18n dictionary with the SAME precedence as app/layout.tsx resolveLocale:
// the kiddy_lang cookie wins; pre-login there is no session to fall back on,
// so it is English. Guard redirects (?error=…, ?confirmed=1) keep their
// semantics; their wording now comes from the login section, and the
// interpolated daycare name sits inside a <bdi> plus dir=auto so the RTL
// bidi wrap artifacts (("?Forgot your password" etc.) cannot recur.

type LoginSearchParams = {
  confirmed?: string;
  error?: string;
  tenant?: string;
  reason?: string;
};

// KID-236/KID-245 guard redirect kinds -> dict keys (wording identical to
// what the login action itself returns after a failed gate).
const GUARD_KEYS: Record<string, string> = {
  withdrawn: "withdrawn",
  disabled: "noAccess",
  "operator-entry-invalid": "operatorEntryInvalid",
};

export default async function LoginPage({ searchParams }: { searchParams?: LoginSearchParams }) {
  const cookieStore = cookies();
  const cookieLang = cookieStore.get(LANG_COOKIE)?.value;
  const locale: Locale = localeOf(cookieLang);
  const dict = getDictionary(locale);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, `login.${key}`, vars);

  const params = searchParams ?? {};
  const confirmed = params.confirmed === "1";

  // Build the guard/red notice as content (plain string or the isolated-name
  // wrong-tenant message) so the tenancy wording stays in one place (lib/i18n).
  let guard: React.ReactNode = null;
  if (params.error === "wrong-tenant") {
    const name = (params.tenant ?? "").trim().slice(0, 80);
    guard = name ? t("wrongTenantNamed", { name }) : t("wrongTenant");
  } else if (params.error === "disabled-institute") {
    // KID-245: billing block vs manual disable, in the visitor's language.
    const reason: TenancyDisabledReason = params.reason === "billing" ? "billing" : "manual";
    guard = tenancyDisabledMessage(reason, locale);
  } else if (params.error) {
    const key = GUARD_KEYS[params.error];
    guard = key ? t(key) : null;
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <LoginBrand brandName={dict.app.name} />
      <h1 className="title mt-4">{t("signIn")}</h1>
      <p className="subtitle">{t("welcomeBack")}</p>
      {guard && !confirmed && (
        <div
          className="small"
          style={{
            background: "#fee2e2",
            border: "1px solid #dc2626",
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 16,
          }}
          dir="auto"
        >
          <bdi>{guard}</bdi>
        </div>
      )}
      {confirmed && (
        <div
          className="small"
          style={{
            background: "#d1fae5",
            border: "1px solid #10b981",
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 16,
          }}
          dir="auto"
        >
          {t("emailConfirmed")}
        </div>
      )}
      <LoginForm emailLabel={t("emailLabel")} passwordLabel={t("passwordLabel")} submitLabel={t("signIn")} />
      <p className="small mt-3">
        <Link href="/forgot-password">{t("forgotPassword")}</Link>
      </p>
      <p className="small mt-2">
        <Link href="/register">{t("inviteActivate")}</Link>
      </p>
    </div>
  );
}
