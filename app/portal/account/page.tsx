import { requireSession } from "@/lib/require";
import { accountProfile } from "@/lib/auth";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { getNotificationPrefs, NOTIFICATION_ACTIVITIES } from "@/lib/store";
import { saveNotificationPrefsAction, uploadAccountPhotoAction } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import LanguageSettingsCard from "@/components/LanguageSettingsCard";
import PushNotificationsCard from "@/components/PushNotificationsCard";

export const dynamic = "force-dynamic";

// KID-487: localized activity labels for the preferences table (EN/AR via the
// account dictionary — every staff activity got a portal.pref* key).

const NOTIFICATION_LABEL_KEYS: Record<string, string> = {
  newsfeed: "portal.prefNewsfeed",
  homework: "portal.prefHomework",
  supplies: "portal.prefSupplies",
  billing: "portal.prefBilling",
  attendance: "portal.prefAttendance",
  incidents: "portal.prefIncidents",
  messages: "portal.prefMessages",
  daily_report: "portal.prefDailyReport",
  events: "portal.prefEvents",
};

export default async function PortalAccountPage({ searchParams }: { searchParams: { saved?: string } }) {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const profile = await accountProfile(session.accountId);
  const prefs = await getNotificationPrefs(session.accountId);
  const displayName = profile.fullName || session.email;

  const on = (activity: string, channel: string) => {
    const hit = (prefs as any[]).find((p) => p.activity === activity && p.channel === channel);
    // KID-480/KID-487: a missing row defaults to enabled for inapp AND push
    // (browser permission is the push consent); email stays opt-in.
    return hit ? Number(hit.enabled) !== 0 : channel !== "email";
  };

  const pushLabels = {
    title: tr(dict, "portal.pushTitle"),
    hint: tr(dict, "portal.pushHint"),
    enable: tr(dict, "portal.pushEnable"),
    disable: tr(dict, "portal.pushDisable"),
    enabled: tr(dict, "portal.pushEnabled"),
    denied: tr(dict, "portal.pushDenied"),
    unsupported: tr(dict, "portal.pushUnsupported"),
    notConfigured: tr(dict, "portal.pushNotConfigured"),
    testButton: tr(dict, "portal.pushTestButton"),
    testSent: tr(dict, "portal.pushTestSent"),
    soundLabel: tr(dict, "portal.soundLabel"),
    soundHint: tr(dict, "portal.soundHint"),
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

      {/* KID-487: the push subscription card is role-agnostic — every staff
          role (owner/admin/teacher/caregiver with or without photo upload)
          can enable and test push from the same component the parent shell
          uses. /api/push/* routes are session-gated, not role-gated. */}
      <div className="card mb-4">
        <PushNotificationsCard labels={pushLabels} />
      </div>

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "account.notificationPrefs")}</h3>
        <p className="small muted">{tr(dict, "account.notificationPrefsHint")}</p>
        {searchParams.saved && <div className="card mb-3" role="status"><strong>{tr(dict, "account.prefsSaved")}</strong></div>}
        <form action={saveNotificationPrefsAction}>
          <table className="data">
            <thead><tr><th>{tr(dict, "account.activity")}</th><th>{tr(dict, "account.email")}</th><th>{tr(dict, "account.inApp")}</th><th>{tr(dict, "account.push")}</th></tr></thead>
            <tbody>
              {(NOTIFICATION_ACTIVITIES as readonly string[]).map((a) => (
                <tr key={a}>
                  <td style={{ fontWeight: 600 }}>{tr(dict, NOTIFICATION_LABEL_KEYS[a] ?? a)}</td>                  <td><input type="checkbox" name={`${a}_email`} defaultChecked={on(a, "email")} /></td>
                  <td><input type="checkbox" name={`${a}_inapp`} defaultChecked={on(a, "inapp")} /></td>
                  <td><input type="checkbox" name={`${a}_push`} defaultChecked={on(a, "push")} /></td>
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
