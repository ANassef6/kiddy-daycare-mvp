import { requireSession } from "@/lib/require";
import { storageSrcFor } from "@/lib/storage";
import { accountProfile, getAccount, mustChangePasswordFor } from "@/lib/auth";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { getNotificationPrefs, NOTIFICATION_ACTIVITIES } from "@/lib/store";
import { saveNotificationPrefsAction, uploadAccountPhotoAction } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import LanguageSettingsCard from "@/components/LanguageSettingsCard";
import ChangePasswordCard from "@/components/ChangePasswordCard";

export const dynamic = "force-dynamic";

const NOTIFICATION_LABELS: Record<string, string> = {
  newsfeed: "Newsfeed posts",
  homework: "Homework",
  supplies: "Supplies",
  billing: "Billing",
  attendance: "Attendance",
  incidents: "Incidents",
  messages: "Messages",
  daily_report: "Daily reports",
  events: "Events",
};

export default async function PortalAccountPage({ searchParams }: { searchParams: Promise<{ saved?: string; pw?: string }> }) {
  const session = await requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const profile = await accountProfile(session.accountId);
  const prefs = await getNotificationPrefs(session.accountId);
  const search = await searchParams;
  // KID-495: temp-password accounts get a prominent (non-blocking) hint above
  // the card, and the card itself rides the pw= feedback from the action.
  const [tempPasswordFlagged, pwStatus] = await Promise.all([
    getAccount(session.accountId).then((row) => row && mustChangePasswordFor(row)),
    Promise.resolve(search.pw),
  ]);
  const displayName = profile.fullName || session.email;

  const on = (activity: string, channel: string) => {
    const hit = (prefs as any[]).find((p) => p.activity === activity && p.channel === channel);
    return hit ? Number(hit.enabled) !== 0 : channel === "inapp";
  };

  return (
    <div>
      <h1 className="title">{tr(dict, "account.settingsTitle")}</h1>
      <p className="subtitle">{tr(dict, "account.settingsSubtitle")}</p>

      <div className="card mb-4">
        <div className="row" style={{ alignItems: "center", gap: 16 }}>
          <Avatar src={await storageSrcFor(profile.photoUrl)} name={displayName} size={64} />
          <div style={{ flex: 1 }}>
            <h2 className="subtitle" style={{ margin: 0 }}>{displayName}</h2>
            <div className="small muted">{session.email}</div>
            <div className="small muted" style={{ textTransform: "capitalize" }}>{session.role}</div>
          </div>
          {profile.staffId && (
            <form action={uploadAccountPhotoAction} encType="multipart/form-data" className="row" style={{ gap: 8, alignItems: "center" }}>
              <input type="hidden" name="staffId" value={profile.staffId} />
              <input type="file" name="file" accept="image/*" required style={{ maxWidth: 180 }} />
              <button className="btn btn-ghost small" type="submit">{tr(dict, "account.uploadPhoto")}</button>
            </form>
          )}
        </div>
      </div>

      <LanguageSettingsCard locale={locale} dict={dict} />

      {/* KID-495: change password — verifies current, min 8 chars, updates
          GoTrue + app hash, clears the temp-password flag. */}
      <ChangePasswordCard dict={dict} status={pwStatus} />
      {tempPasswordFlagged && pwStatus !== "changed" && (
        <div
          className="card mb-4"
          role="alert"
          style={{ borderLeft: "4px solid #b45309", background: "#fffbeb" }}
        >
          <strong>{tr(dict, "account.tempPasswordFlagged")}</strong>
        </div>
      )}

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "account.notificationPrefs")}</h3>
        <p className="small muted">{tr(dict, "account.notificationPrefsHint")}</p>
        {search.saved && <div className="card mb-3" role="status"><strong>{tr(dict, "account.prefsSaved")}</strong></div>}
        <form action={saveNotificationPrefsAction}>
          <table className="data">
            <thead><tr><th>{tr(dict, "account.activity")}</th><th>{tr(dict, "account.email")}</th><th>{tr(dict, "account.inApp")}</th></tr></thead>
            <tbody>
              {(NOTIFICATION_ACTIVITIES as readonly string[]).map((a) => (
                <tr key={a}>
                  <td style={{ fontWeight: 600 }}>{NOTIFICATION_LABELS[a] ?? a}</td>
                  <td><input type="checkbox" name={`${a}_email`} defaultChecked={on(a, "email")} /></td>
                  <td><input type="checkbox" name={`${a}_inapp`} defaultChecked={on(a, "inapp")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-primary mt-3" type="submit">{tr(dict, "account.saveNotificationPrefs")}</button>
        </form>
      </div>
    </div>
  );
}
