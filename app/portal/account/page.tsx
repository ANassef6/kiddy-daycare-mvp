import { requireSession } from "@/lib/require";
import { accountProfile } from "@/lib/auth";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { getNotificationPrefs, NOTIFICATION_ACTIVITIES } from "@/lib/store";
import { saveNotificationPrefsAction, uploadAccountPhotoAction } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import LanguageSettingsCard from "@/components/LanguageSettingsCard";

export const dynamic = "force-dynamic";

const NOTIFICATION_LABELS: Record<string, string> = {
  newsfeed: "Newsfeed posts",
  homework: "Homework",
  supplies: "Supplies",
  billing: "Billing",
  attendance: "Attendance",
  incidents: "Incidents",
  messages: "Messages",
};

export default async function PortalAccountPage({ searchParams }: { searchParams: { saved?: string } }) {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const profile = await accountProfile(session.accountId);
  const prefs = await getNotificationPrefs(session.accountId);
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
          <Avatar src={profile.photoUrl} name={displayName} size={64} />
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

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "account.notificationPrefs")}</h3>
        <p className="small muted">{tr(dict, "account.notificationPrefsHint")}</p>
        {searchParams.saved && <div className="card mb-3" role="status"><strong>{tr(dict, "account.prefsSaved")}</strong></div>}
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
