// KID-2477: the read-only Center configuration view inside the per-daycare
// platform Settings section. The daycare itself owns these values (portal
// Settings → Center details / Working hours); the platform view only reports
// them, so there is no form and no save action anywhere on this page.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isPlatformOperatorEmail, isPlatformOperatorRole } from "@/lib/platform";
import { getInstitute, getWorkingHours } from "@/lib/store";
import { DAY_LABEL_KEYS, DAY_LABELS, workingHoursConfigured } from "@/lib/working-hours";
import { normalizeTimeZone } from "@/lib/timezone";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function DaycareCenterConfigurationPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  const session = await requireSession();
  if (!isPlatformOperatorRole(session.role) || !isPlatformOperatorEmail(session.email)) {
    redirect("/login");
  }
  const { dict, dir } = await i18nForAccount(session.accountId);
  const instituteId = String(params.id ?? "");
  const inst = await getInstitute(instituteId);
  if (!inst) redirect("/platform?error=missing-id");
  const week = await getWorkingHours(instituteId);
  const timeZone = normalizeTimeZone(inst.timezone);
  const parentCheckInOut =
    inst.allow_parent_check_inout === undefined ||
    Number(inst.allow_parent_check_inout) !== 0;
  const hasHours = workingHoursConfigured(week);

  return (
    <div dir={dir}>
      <h1 className="title">{tr(dict, "platform.centerConfigTitle")}</h1>
      <p className="subtitle">{String(inst.name)}</p>
      <p className="small muted">{tr(dict, "platform.centerConfigHint")}</p>

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "platform.centerCheckInOutTitle")}</h3>
        <p className="small">
          <strong>
            {parentCheckInOut
              ? tr(dict, "platform.centerCheckInOutAllowed")
              : tr(dict, "platform.centerCheckInOutBlocked")}
          </strong>
        </p>
        <p className="small muted">{tr(dict, "platform.centerCheckInOutHint")}</p>
      </div>

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "platform.centerWorkingHoursTitle")}</h3>
        {hasHours ? (
          <table className="data">
            <thead>
              <tr>
                <th>{tr(dict, "settings.day")}</th>
                <th>{tr(dict, "settings.open")}</th>
                <th>{tr(dict, "settings.close")}</th>
              </tr>
            </thead>
            <tbody>
              {DAY_LABELS.map((fallback, index) => {
                const key = String(index);
                const day = week[key];
                return (
                  <tr key={key}>
                    <td>
                      <strong>{tr(dict, DAY_LABEL_KEYS[index] ?? "settings.day") || fallback}</strong>
                    </td>
                    <td>{day ? day.open : tr(dict, "platform.centerClosed")}</td>
                    <td>{day ? day.close : tr(dict, "platform.centerClosed")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="small muted">{tr(dict, "platform.centerWorkingHoursUnset")}</p>
        )}
        <p className="small muted">{tr(dict, "platform.centerWorkingHoursHint")}</p>
      </div>

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "platform.centerTimezoneTitle")}</h3>
        <p className="small">
          <strong>{timeZone}</strong>
        </p>
        <p className="small muted">{tr(dict, "platform.centerTimezoneHint")}</p>
      </div>
    </div>
  );
}
