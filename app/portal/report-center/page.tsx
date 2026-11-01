import { requireSession } from "@/lib/require";
import { reportCenterStats, staffPerformance, attendanceOn, listChildren, listRoomsScoped, recentReports } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-221: the Report center shipped its whole surface English-only inside
// the translated shell — headings, stats cards, both tables (including the
// raw English role enum), all filter labels, export buttons, statuses and
// the always-English toDateString report dates. Localized end-to-end; report
// mood and status values go through their dictionaries too.
export default async function PortalReportCenterPage({
  searchParams,
}: {
  searchParams: { child?: string; from?: string; to?: string; status?: string };
}) {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const roleLabel = (role: string) => {
    const key = `roles.${role}`;
    return tr(dict, key) || role;
  };
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("reportCenter.noInstitute")}</p>;

  // KID-103: report-center counts and filters respect classroom assignments.
  const [stats, performance, children, rooms, dailyReports] = await Promise.all([
    reportCenterStats(instituteId, session.accountId),
    staffPerformance(instituteId),
    listChildren(instituteId, { accountId: session.accountId }),
    listRoomsScoped(instituteId, session.accountId),
    recentReports(instituteId, 50, session.accountId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const attendance = await attendanceOn(instituteId, today, { accountId: session.accountId });
  // KID-52 #7: filtered-reports section moved here from the removed Reports
  // tab so billing/daily filters + exports live in one place.
  const q = (searchParams.child ?? "").toLowerCase();
  const filtered = (dailyReports as any[]).filter((r) => {
    if (q && !`${r.first_name} ${r.last_name}`.toLowerCase().includes(q)) return false;
    if (searchParams.from && String(r.report_date) < searchParams.from) return false;
    if (searchParams.to && String(r.report_date) > searchParams.to) return false;
    if (searchParams.status === "sick" && !r.sick) return false;
    return true;
  });
  const qs = new URLSearchParams({
    child: searchParams.child ?? "",
    from: searchParams.from ?? "",
    to: searchParams.to ?? "",
    status: searchParams.status ?? "",
  }).toString();
  const reportCoverage = stats.childrenCount ? `${((stats.reportsCount / stats.childrenCount) * 100).toFixed(0)}%` : "—";
  const perDay = stats.childrenCount ? Math.round(stats.reportsCount / Math.max(stats.childrenCount, 1)) : 0;
  // Mood rows store the raw enum ("happy"/"fussy"/…); translate through the
  // profile dictionaries and fall back to the raw value for unknown kinds.
  const moodLabel = (mood: string) => {
    if (!mood) return "—";
    const v = tr(dict, `profile.${mood}`);
    return v || mood.charAt(0).toUpperCase() + mood.slice(1);
  };

  return (
    <div>
      <h1 className="title">{t("reportCenter.title")}</h1>
      <div className="subtitle">{t("reportCenter.subtitle")}</div>

      <div className="card mb-4">
        <h3 className="subtitle">{t("reportCenter.quickAccess")}</h3>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <a className="btn btn-ghost small" href="/api/export?type=billing">{t("reportCenter.dlBilling")}</a>
          <a className="btn btn-ghost small" href="/api/export?type=attendance">{t("reportCenter.dlAttendance")}</a>
          <a className="btn btn-ghost small" href="/api/export?type=children">{t("reportCenter.dlChildren")}</a>
          <a className="btn btn-ghost small" href="#filtered">{t("reportCenter.filteredAnchor")}</a>
        </div>
      </div>

      <h3 className="subtitle">{t("reportCenter.overview")}</h3>
      <div className="grid mb-4">
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{stats.childrenCount}</div><div className="muted">{t("reportCenter.colChildren")}</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{attendance.filter((a) => a.last_event === "in").length}</div><div className="muted">{t("reportCenter.colCheckedIn")}</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{stats.reportsCount}</div><div className="muted">{t("reportCenter.colDailyReports")}</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{reportCoverage}</div><div className="muted">{t("reportCenter.colCoverage")}</div></div>
      </div>

      <div className="grid mb-4">
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.checkInsCount}</div><div className="muted">{t("reportCenter.colCheckIns")}</div></div>
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.observationCount}</div><div className="muted">{t("reportCenter.colObservations")}</div></div>
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.newsfeedCount}</div><div className="muted">{t("reportCenter.colNewsfeed")}</div></div>
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.mediaCount}</div><div className="muted">{t("reportCenter.colPhotosVideos")}</div></div>
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.incidentCount}</div><div className="muted">{t("reportCenter.colIncidents")}</div></div>
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.consentsAnswered}</div><div className="muted">{t("reportCenter.colConsents")}</div></div>
      </div>

      <div className="card mb-4">
        <h3 className="subtitle">{t("reportCenter.roomsTitle")}</h3>
        <table className="data">
          <thead><tr><th>{t("reportCenter.thRoom")}</th><th>{t("reportCenter.thCapacity")}</th><th>{t("reportCenter.thEnrolled")}</th><th>{t("reportCenter.thPerChild")}</th></tr></thead>
          <tbody>
            {rooms.map((r: any) => {
              const enrolled = children.filter((c: any) => c.room_id === r.id).length;
              return (
                <tr key={r.id}>
                  <td>{r.name}</td><td>{r.capacity ?? "—"}</td><td>{enrolled}</td><td>{enrolled ? Math.round((stats.reportsCount * enrolled) / Math.max(stats.childrenCount, 1)) : 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 className="subtitle">{t("reportCenter.perfTitle")}</h3>
        <table className="data">
          <thead>
            <tr>
              <th>{t("reportCenter.thStaff")}</th><th>{t("reportCenter.thRole")}</th><th>{t("reportCenter.thReportsAuthored")}</th><th>{t("reportCenter.thCheckIns")}</th><th>{t("reportCenter.thIncidents")}</th><th>{t("reportCenter.thObservations")}</th>
            </tr>
          </thead>
          <tbody>
            {performance.map((p: any) => (
              <tr key={p.account_id}>
                <td>{p.name}</td><td>{roleLabel(String(p.role))}</td>
                <td><strong>{p.reports_authored}</strong></td>
                <td>{p.check_ins}</td>
                <td>{p.incidents_logged}</td>
                <td>{p.observations}</td>
              </tr>
            ))}
            {performance.length === 0 && <tr><td colSpan={6} className="muted">{t("reportCenter.noStaff")}</td></tr>}
          </tbody>
        </table>
        <p className="muted small mt-3">{t("reportCenter.paceNote", { n: perDay })}</p>
      </div>

      <div className="card mt-4" id="filtered">
        <h3 className="subtitle">{t("reportCenter.filtersTitle")}</h3>
        <form method="get" className="row">
          <div className="col field"><label className="label">{t("reportCenter.childName")}</label><input className="input" name="child" defaultValue={searchParams.child ?? ""} placeholder={t("reportCenter.childNamePlaceholder")} /></div>
          <div className="col field"><label className="label">{t("reportCenter.from")}</label><input className="input" type="date" name="from" defaultValue={searchParams.from ?? ""} /></div>
          <div className="col field"><label className="label">{t("reportCenter.to")}</label><input className="input" type="date" name="to" defaultValue={searchParams.to ?? ""} /></div>
          <div className="col field"><label className="label">{t("reportCenter.status")}</label>
            <select className="select" name="status" defaultValue={searchParams.status ?? ""}>
              <option value="">{t("reportCenter.any")}</option>
              <option value="pending">{t("reportCenter.pending")}</option>
              <option value="paid">{t("reportCenter.paid")}</option>
              <option value="sick">{t("reportCenter.sickDaily")}</option>
            </select>
          </div>
          <div className="field" style={{ alignSelf: "flex-end" }}><button className="btn btn-primary" type="submit">{t("reportCenter.runFilter")}</button></div>
        </form>
        <div className="row mt-2" style={{ gap: 8 }}>
          <a className="btn btn-ghost small" href={`/api/export?type=billing&${qs}`}>{t("reportCenter.dlBillingFiltered")}</a>
          <a className="btn btn-ghost small" href="/api/export?type=attendance">{t("reportCenter.dlAttendanceFiltered")}</a>
        </div>
      </div>

      <div className="card mt-4">
        <h3 className="subtitle">{t("reportCenter.dailyTitle")}</h3>
        <table className="data">
          <thead><tr><th>{t("reportCenter.thDate")}</th><th>{t("reportCenter.thChild")}</th><th>{t("reportCenter.thMood")}</th><th>{t("reportCenter.thSummary")}</th><th>{t("reportCenter.thSick")}</th></tr></thead>
          <tbody>
            {filtered.map((r: any) => (
              <tr key={r.id}>
                <td className="small">{fmtDateFor(locale, r.report_date)}</td>
                <td><strong>{r.first_name} {r.last_name}</strong></td>
                <td>{moodLabel(String(r.mood ?? ""))}</td>                <td className="small" style={{ maxWidth: 340 }}>{r.summary || "—"}</td>
                <td>{r.sick ? <span className="badge badge-red">{t("reportCenter.sickBadge")}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="muted mt-3">{t("reportCenter.noMatches")}</p>}
        <p className="muted small mt-2">{t("reportCenter.inScope", { count: children.length })}</p>
</div>
    </div>
  );
}

