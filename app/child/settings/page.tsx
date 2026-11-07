import { requireSession } from "@/lib/require";
import { ensureSchema } from "@/lib/db";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { getNotificationPrefs, PARENT_NOTIFICATION_ACTIVITIES } from "@/lib/store";
import { saveParentNotificationPrefsAction, updateParentAccountAction } from "@/lib/actions";
import { accountProfile } from "@/lib/auth";
import Avatar from "@/components/Avatar";
import LanguageSettingsCard from "@/components/LanguageSettingsCard";
import PushNotificationsCard from "@/components/PushNotificationsCard";

export const dynamic = "force-dynamic";

// KID-474: parent notification settings — one toggle per activity that can
// reach a parent, persisted in notification_pref (server-enforced: the emit
// path skips in-app delivery for disabled rows; no row defaults to enabled).
const PARENT_ACTIVITY_LABEL_KEYS: Record<string, string> = {
  messages: "parent.prefMessages",
  daily_report: "parent.prefDailyReport",
  newsfeed: "parent.prefNewsfeed",
  events: "parent.prefEvents",
  attendance: "parent.prefAttendance",
  incidents: "parent.prefIncidents",
  billing: "parent.prefBilling",
};

export default async function ParentSettingsPage({
  searchParams,
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  await ensureSchema();
  const prefs = await getNotificationPrefs(session.accountId);
  // KID-486: the self-account editor needs the live profile (name + avatar).
  const profile = await accountProfile(session.accountId);
  const displayName = profile.fullName || session.email;

  const on = (activity: string, channel: string) => {
    const hit = (prefs as { activity: string; channel: string; enabled: unknown }[]).find(
      (p) => p.activity === activity && p.channel === channel
    );
    // KID-480: a missing row defaults to enabled for inapp AND push (browser
    // permission is the push consent); email stays opt-in.
    return hit ? Number(hit.enabled) !== 0 : channel !== "email";
  };

  const pushLabels = {
    title: tr(dict, "parent.pushTitle"),
    hint: tr(dict, "parent.pushHint"),
    enable: tr(dict, "parent.pushEnable"),
    disable: tr(dict, "parent.pushDisable"),
    enabled: tr(dict, "parent.pushEnabled"),
    denied: tr(dict, "parent.pushDenied"),
    unsupported: tr(dict, "parent.pushUnsupported"),
    notConfigured: tr(dict, "parent.pushNotConfigured"),
    testButton: tr(dict, "parent.pushTestButton"),
    testSent: tr(dict, "parent.pushTestSent"),
    soundLabel: tr(dict, "parent.soundLabel"),
    soundHint: tr(dict, "parent.soundHint"),
  };

  return (
    <div>
      <h1 className="title">{tr(dict, "account.settingsTitle")}</h1>
      <LanguageSettingsCard locale={locale} dict={dict} />

      {/* KID-486: every parent-tier account (parent / family / pickup) edits
          its OWN details — name, password, photo. The action updates the
          account's own row only; child records are never reachable here. */}
      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "account.settingsSubtitle")}</h3>
        {searchParams.saved && (
          <p className="badge badge-green" style={{ display: "inline-block" }}>
            {tr(dict, "account.detailsSaved")}
          </p>
        )}
        {searchParams.error === "short-password" && (
          <p className="small" style={{ color: "#dc2626", fontWeight: 600 }}>
            {tr(dict, "account.newPasswordTooShort")}
          </p>
        )}
        <form action={updateParentAccountAction} encType="multipart/form-data" className="mt-3">
          <div className="row" style={{ alignItems: "center", gap: 16 }}>
            <Avatar src={profile.photoUrl} name={displayName} size={64} />
            <div style={{ flex: 1 }}>
              <h2 className="subtitle" style={{ margin: 0 }}>{displayName}</h2>
              <div className="small muted">{session.email}</div>
            </div>
          </div>
          <div className="field mt-3">
            <label className="label">{tr(dict, "account.fullName")}</label>
            <input className="input" name="fullName" defaultValue={profile.fullName} />
          </div>
          <div className="field">
            <label className="label">{tr(dict, "account.photo")}</label>
            <input className="input" type="file" name="photo" accept="image/*" />
          </div>
          <div className="field">
            <label className="label">{tr(dict, "account.newPassword")}</label>
            <input className="input" type="password" name="password" autoComplete="new-password" />
            <p className="small muted">{tr(dict, "account.newPasswordHint")}</p>
          </div>
          <button className="btn btn-primary" type="submit">{tr(dict, "account.saveDetails")}</button>
        </form>
      </div>

      <div className="card mb-4">
        <PushNotificationsCard labels={pushLabels} />
      </div>

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "parent.notifPrefsTitle")}</h3>
        <p className="small muted">{tr(dict, "parent.notifPrefsHint")}</p>
        {searchParams.saved && (
          <div className="card mb-3" role="status">
            <strong>{tr(dict, "parent.notifPrefsSaved")}</strong>
          </div>
        )}
        <form action={saveParentNotificationPrefsAction}>
          <table className="data">
            <thead>
              <tr>
                <th>{tr(dict, "account.activity")}</th>
                <th>{tr(dict, "account.email")}</th>
                <th>{tr(dict, "account.inApp")}</th>
                <th>{tr(dict, "account.push")}</th>
              </tr>
            </thead>
            <tbody>
              {(PARENT_NOTIFICATION_ACTIVITIES as readonly string[]).map((a) => (
                <tr key={a}>
                  <td style={{ fontWeight: 600 }}>{tr(dict, PARENT_ACTIVITY_LABEL_KEYS[a] ?? a)}</td>
                  <td><input type="checkbox" name={`${a}_email`} defaultChecked={on(a, "email")} /></td>
                  <td><input type="checkbox" name={`${a}_inapp`} defaultChecked={on(a, "inapp")} /></td>
                  <td><input type="checkbox" name={`${a}_push`} defaultChecked={on(a, "push")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-primary mt-3" type="submit">
            {tr(dict, "parent.savePrefs")}
          </button>
        </form>
      </div>
    </div>
  );
}
