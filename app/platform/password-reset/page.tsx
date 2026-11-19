// KID-2442: the platform operator's one-click password reset.
//
// Two explicit steps, both server-rendered (this repo has no client
// data-fetching libs):
//   1. GET ?email=... resolves the account and shows its name, role and
//      daycare(s) — nothing is written by the lookup.
//   2. The confirm form POSTs resetAccountPasswordAction, which re-checks the
//      operator, re-reads the account, sets the platform default password plus
//      the KID-2439 forced-change flag, and writes the audit row.
//
// The page is inside app/platform/layout.tsx, but it repeats the operator
// guard so a direct render can never bypass the allowlist check.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isPlatformOperator, PLATFORM_OPERATOR_ROLE } from "@/lib/platform";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import {
  DEFAULT_ACCOUNT_PASSWORD,
  lookupAccountForPasswordReset,
} from "@/lib/platform-accounts";
import { resetAccountPasswordAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

type SearchParams = {
  email?: string;
  reset?: string;
  error?: string;
};

export default async function PlatformPasswordResetPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  if (!isPlatformOperator(session.role, session.email)) redirect("/login");

  const { dict, dir } = await i18nForAccount(session.accountId);
  const typedEmail = String(searchParams.email ?? "").trim();
  const target = typedEmail ? await lookupAccountForPasswordReset(typedEmail) : null;
  const resetDone = searchParams.reset === "1";
  const error = String(searchParams.error ?? "");

  const roleLabel = (role: string) => {
    if (role === PLATFORM_OPERATOR_ROLE) return tr(dict, "platform.operator");
    const key = `roles.${role}`;
    const value = tr(dict, key);
    // Unknown/internal role values fall back to the raw value rather than the
    // missing-key marker.
    return value === key || value.startsWith("MISSING:") ? role : value;
  };

  const errorMessage =
    error === "confirm"
      ? tr(dict, "platform.passwordResetConfirmRequired")
      : error === "failed"
        ? tr(dict, "platform.passwordResetFailed")
        : error === "unknown" || (typedEmail && !target && !resetDone)
          ? tr(dict, "platform.passwordResetNotFound")
          : "";

  return (
    <div dir={dir}>
      <h1 className="title">{tr(dict, "platform.passwordResetTitle")}</h1>
      <p className="subtitle">{tr(dict, "platform.passwordResetSubtitle")}</p>
      <p className="small">
        <a href="/platform" style={{ fontWeight: 700 }}>
          ← {tr(dict, "platform.passwordResetBack")}
        </a>
      </p>

      {resetDone && (
        <div className="card mb-4 banner-success">
          {tr(dict, "platform.passwordResetDone", { email: typedEmail })}
        </div>
      )}
      {errorMessage && <div className="card mb-4 banner-error">{errorMessage}</div>}

      <form className="card mb-4" method="get" action="/platform/password-reset">
        <div className="field">
          <label className="label" htmlFor="reset-account-email">
            {tr(dict, "platform.passwordResetEmailLabel")}
          </label>
          <input
            className="input"
            id="reset-account-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            defaultValue={typedEmail}
            placeholder="owner@daycare.test"
          />
        </div>
        <button className="btn btn-primary" type="submit">
          {tr(dict, "platform.passwordResetLookup")}
        </button>
      </form>

      {target && (
        <div className="card">
          <h3 className="subtitle">{tr(dict, "platform.passwordResetAccountTitle")}</h3>
          <table style={{ borderCollapse: "collapse", marginBottom: 12 }}>
            <tbody>
              <tr>
                <th className="small" style={{ textAlign: "start", padding: "4px 12px 4px 0" }}>
                  {tr(dict, "platform.passwordResetName")}
                </th>
                <td style={{ padding: 4 }}>{target.fullName}</td>
              </tr>
              <tr>
                <th className="small" style={{ textAlign: "start", padding: "4px 12px 4px 0" }}>
                  {tr(dict, "platform.passwordResetEmail")}
                </th>
                <td style={{ padding: 4 }}>{target.email}</td>
              </tr>
              <tr>
                <th className="small" style={{ textAlign: "start", padding: "4px 12px 4px 0" }}>
                  {tr(dict, "platform.passwordResetRole")}
                </th>
                <td style={{ padding: 4 }}>{roleLabel(target.role)}</td>
              </tr>
              <tr>
                <th className="small" style={{ textAlign: "start", padding: "4px 12px 4px 0" }}>
                  {tr(dict, "platform.passwordResetDaycare")}
                </th>
                <td style={{ padding: 4 }}>
                  {target.institutes.length > 0
                    ? target.institutes.map((i) => i.name).join(", ")
                    : tr(dict, "platform.passwordResetNoDaycare")}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="small muted">
            {tr(dict, "platform.passwordResetWarning", { password: DEFAULT_ACCOUNT_PASSWORD })}
          </p>
          <form action={resetAccountPasswordAction}>
            <input type="hidden" name="accountId" value={target.accountId} />
            <input type="hidden" name="confirm" value="1" />
            <button className="btn btn-primary" type="submit">
              {tr(dict, "platform.passwordResetConfirm")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
