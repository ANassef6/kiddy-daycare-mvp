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
import MediaUploadForm from "@/components/MediaUploadForm";
import { mediaUploadLabels } from "@/lib/media-i18n";
import { MAX_PHOTO_UPLOAD_BYTES } from "@/lib/media-limits";

export const dynamic = "force-dynamic";

const NOTIFICATION_LABEL_KEYS: Record<string, string> = {
  newsfeed: "account.notifNewsfeed",
  homework: "account.notifHomework",
  supplies: "account.notifSupplies",
  billing: "account.notifBilling",
  attendance: "account.notifAttendance",
  incidents: "account.notifIncidents",
  messages: "account.notifMessages",
  daily_report: "account.notifDailyReport",
  events: "account.notifEvents",
};

export default async function PortalAccountPage({ searchParams }: { searchParams: Promise<{ saved?: string; pw?: string; error?: string }> }) {
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

      {(search.error === "photoType" || search.error === "photoSize") && (
        <div role="alert" className="card mb-4" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{tr(dict, "account.photoError")}</p>
        </div>
      )}

      <div className="card mb-4">
        <div className="row" style={{ alignItems: "center", gap: 16 }}>
          <Avatar src={await storageSrcFor(profile.photoUrl)} name={displayName} size={64} />
          <div style={{ flex: 1 }}>
            <h2 className="subtitle" style={{ margin: 0 }}>{displayName}</h2>
            <div className="small muted">{session.email}</div>
            <div className="small muted" style={{ textTransform: "capitalize" }}>{session.role}</div>
          </div>
          {profile.staffId && (
            <MediaUploadForm
              action={uploadAccountPhotoAction}
              encType="multipart/form-data"
              className="row"
              style={{ gap: 8, alignItems: "center" }}
              maxImageBytes={MAX_PHOTO_UPLOAD_BYTES}
              labels={mediaUploadLabels(dict)}
              directUpload={{ purpose: "photo", entityType: "staff", entityId: profile.staffId }}
            >
              <input type="hidden" name="staffId" value={profile.staffId} />
              <input type="file" name="file" accept="image/*" required style={{ maxWidth: 180 }} />
              <button className="btn btn-ghost small" type="submit">{tr(dict, "account.uploadPhoto")}</button>
            </MediaUploadForm>
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
                  <td style={{ fontWeight: 600 }}>{NOTIFICATION_LABEL_KEYS[a] ? tr(dict, NOTIFICATION_LABEL_KEYS[a]) : a}</td>
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
