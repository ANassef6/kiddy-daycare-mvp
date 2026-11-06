import { requireSession } from "@/lib/require";
import { ensureSchema } from "@/lib/db";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { getNotificationPrefs, PARENT_NOTIFICATION_ACTIVITIES } from "@/lib/store";
import { saveParentNotificationPrefsAction } from "@/lib/actions";
import LanguageSettingsCard from "@/components/LanguageSettingsCard";

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
  searchParams: { saved?: string };
}) {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  await ensureSchema();
  const prefs = await getNotificationPrefs(session.accountId);

  const on = (activity: string, channel: string) => {
    const hit = (prefs as { activity: string; channel: string; enabled: unknown }[]).find(
      (p) => p.activity === activity && p.channel === channel
    );
    return hit ? Number(hit.enabled) !== 0 : channel === "inapp";
  };

  return (
    <div>
      <h1 className="title">{tr(dict, "account.settingsTitle")}</h1>
      <LanguageSettingsCard locale={locale} dict={dict} />

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
              </tr>
            </thead>
            <tbody>
              {(PARENT_NOTIFICATION_ACTIVITIES as readonly string[]).map((a) => (
                <tr key={a}>
                  <td style={{ fontWeight: 600 }}>{tr(dict, PARENT_ACTIVITY_LABEL_KEYS[a] ?? a)}</td>
                  <td><input type="checkbox" name={`${a}_email`} defaultChecked={on(a, "email")} /></td>
                  <td><input type="checkbox" name={`${a}_inapp`} defaultChecked={on(a, "inapp")} /></td>
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
