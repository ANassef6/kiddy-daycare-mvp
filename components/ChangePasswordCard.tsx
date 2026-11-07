import { changePasswordAction } from "@/lib/actions";
import { tr, type Dict } from "@/lib/i18n";

// KID-495: shared change-password card for account settings — rendered on the
// staff/admin page (app/portal/account) and the parent page (app/child/settings).
// The server action verifies the current password, enforces the minimum
// length, updates the GoTrue password when an identity exists, and always
// rewrites the app-side hash before clearing must_change_password.
const STATUS_KEYS: Record<string, string> = {
  changed: "account.passwordChanged",
  wrong: "account.passwordWrongCurrent",
  short: "account.passwordTooShort",
  mismatch: "account.passwordMismatch",
};

export function passwordChangeStatusTone(status?: string | null): string {
  return status === "changed" ? "#047857" : "#b91c1c";
}

export default function ChangePasswordCard({ dict, status }: { dict: Dict; status?: string | null }) {
  const statusKey = status ? STATUS_KEYS[status] : undefined;
  return (
    <div className="card mb-4">
      <h3 className="subtitle">{tr(dict, "account.changePasswordTitle")}</h3>
      <p className="small muted">{tr(dict, "account.changePasswordHint")}</p>
      {statusKey && (
        <div
          className="card mb-3"
          role="status"
          style={{ borderLeft: `4px solid ${passwordChangeStatusTone(status)}` }}
        >
          <strong>{tr(dict, statusKey)}</strong>
        </div>
      )}
      {/* Status feedback rides the query string (pw=...) because the action
          redirects; a form error must survive the navigation. */}
      <form action={changePasswordAction}>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "account.currentPassword")}</label>
            <input className="input" name="currentPassword" type="password" required autoComplete="current-password" />
          </div>
        </div>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "account.newPassword")}</label>
            <input className="input" name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "account.confirmPassword")}</label>
            <input className="input" name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" />
          </div>
        </div>
        <button className="btn btn-primary mt-3" type="submit">
          {tr(dict, "account.changePasswordBtn")}
        </button>
      </form>
    </div>
  );
}
