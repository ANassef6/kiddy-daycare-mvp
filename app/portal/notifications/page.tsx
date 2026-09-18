import { requireSession } from "@/lib/require";
import { getNotificationPrefs, NOTIFICATION_ACTIVITIES } from "@/lib/store";
import { saveNotificationPrefsAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  newsfeed: "Newsfeed posts",
  homework: "Homework",
  supplies: "Supplies",
  billing: "Billing",
  attendance: "Attendance",
  incidents: "Incidents",
  messages: "Messages",
};

export default async function PortalNotificationsPage({ searchParams }: { searchParams: { saved?: string } }) {
  const session = requireSession();
  const prefs = await getNotificationPrefs(session.accountId);
  const on = (activity: string, channel: string) => {
    const hit = (prefs as any[]).find((p) => p.activity === activity && p.channel === channel);
    return hit ? Number(hit.enabled) !== 0 : channel === "inapp";
  };

  return (
    <div>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="title">Notifications</h1>
        <a className="btn btn-ghost small" href="/portal/messages">Open messaging center →</a>
      </div>
      <p className="subtitle">Customize how (email / in-app) and for which activities you get notified.</p>
      {searchParams.saved && <div className="card mb-4" role="status"><strong>Preferences saved.</strong></div>}

      <form className="card" action={saveNotificationPrefsAction}>
        <table className="data">
          <thead><tr><th>Activity</th><th>Email</th><th>In-app</th></tr></thead>
          <tbody>
            {(NOTIFICATION_ACTIVITIES as readonly string[]).map((a) => (
              <tr key={a}>
                <td style={{ fontWeight: 600 }}>{LABELS[a] ?? a}</td>
                <td><input type="checkbox" name={`${a}_email`} defaultChecked={on(a, "email")} /></td>
                <td><input type="checkbox" name={`${a}_inapp`} defaultChecked={on(a, "inapp")} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn btn-primary mt-3" type="submit">Save preferences</button>
      </form>
    </div>
  );
}
