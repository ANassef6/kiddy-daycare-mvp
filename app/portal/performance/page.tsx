import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listStaff, staffActivity } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateTimeFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type MetricDef = { key: string; labelKey: string; icon: string; accent: string };

const COMMUNICATION: MetricDef[] = [
  { key: "posts", labelKey: "performance.metricPosts", icon: "📝", accent: "#3B82F6" },
  { key: "media", labelKey: "performance.metricMedia", icon: "🖼️", accent: "#8B5CF6" },
  { key: "messages", labelKey: "performance.metricMessages", icon: "💬", accent: "#F59E0B" },
];
const DEVELOPMENT: MetricDef[] = [
  { key: "observations", labelKey: "performance.metricObservations", icon: "🔭", accent: "#10B981" },
  { key: "assessments", labelKey: "performance.metricAssessments", icon: "📝", accent: "#EC4899" },
  { key: "twoYearChecks", labelKey: "performance.metricTwoYearChecks", icon: "🧸", accent: "#06B6D4" },
];

// KID-221: staff performance was fully English (title, filter form, metric
// labels, deep dives, and the English "Last updated" timestamp). Localized.
export default async function PortalPerformancePage({
  searchParams,
}: {
  searchParams?: { staffId?: string; from?: string; to?: string };
}) {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("performance.noInstitute")}</p>;
  const staff = await listStaff(instituteId);
  const staffId = searchParams?.staffId ?? staff[0]?.id ?? "";
  const from = searchParams?.from ?? "";
  const to = searchParams?.to ?? "";
  const activeStaff = staff.find((s: any) => String(s.id) === staffId);
  const activity = staffId ? await staffActivity(staffId, { from: from || undefined, to: to || undefined }) : null;

  const renderBars = (defs: MetricDef[], colors: Record<string, string>) => {
    const max = Math.max(1, ...defs.map((d) => Number(activity?.[d.key] ?? 0)));
    return (
      <div className="grid">
        {defs.map((def) => {
          const value = Number(activity?.[def.key] ?? 0);
          return (
            <div className="card" key={def.key}>
              <div className="row" style={{ alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>{def.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 26, fontWeight: 800 }}>{value}</div>
                  <div className="muted small">{t(def.labelKey)}</div>
                </div>
              </div>
              <div style={{ height: 10, borderRadius: 6, background: "var(--color-border)", overflow: "hidden", marginTop: 10 }}>
                <div style={{ width: `${Math.round((value / max) * 100)}%`, height: "100%", background: colors[def.key] ?? def.accent, borderRadius: 6 }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <h1 className="title">{t("performance.title")}</h1>
      <div className="subtitle">{t("performance.subtitle")}</div>

      <div className="card mb-4">
        <form method="get" className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{t("performance.staffMember")}</label>
            <select className="select" name="staffId" defaultValue={staffId ?? ""} style={{ minWidth: 220 }}>
              {staff.map((s: any) => (
                <option key={String(s.id)} value={String(s.id)}>{s.full_name}{s.role ? ` (${t(`roles.${s.role}`, {})})` : ""}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{t("performance.from")}</label>
            <input className="input" type="date" name="from" defaultValue={from || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{t("performance.to")}</label>
            <input className="input" type="date" name="to" defaultValue={to || new Date().toISOString().slice(0, 10)} />
          </div>
          <button className="btn btn-primary small" type="submit">{t("performance.apply")}</button>
          <span className="small muted">{t("performance.lastUpdated", { when: fmtDateTimeFor(locale, new Date()) })}</span>
        </form>
      </div>

      {!activity ? (
        <p className="muted">{t("performance.pickStaff")}</p>
      ) : (
        <div>
          <h3 className="subtitle">
            {t("performance.communication", { name: activeStaff?.full_name ?? t("performance.staffFallback") })}
            {from ? <span className="muted"> · {t("performance.since", { from })}</span> : ""}
            {to ? <span className="muted"> · {t("performance.until", { to })}</span> : ""}
          </h3>
          {renderBars(COMMUNICATION, { posts: "#3B82F6", media: "#8B5CF6", messages: "#F59E0B" })}

          <h3 className="subtitle mt-4">
            {t("performance.childDevelopment", { name: activeStaff?.full_name ?? t("performance.staffFallback") })}
          </h3>
          {renderBars(DEVELOPMENT, { observations: "#10B981", assessments: "#EC4899", twoYearChecks: "#06B6D4" })}
        </div>
      )}

      <div className="card mt-4">
        <h3 className="subtitle">{t("performance.deepDives")}</h3>
        <div className="grid">
          <Link className="card" href={`/portal/report-center?staffId=${staffId}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ fontWeight: 700 }}>{t("performance.diveReports")}</div>
            <div className="muted small mt-1">{t("performance.diveReportsHint")}</div>
          </Link>
          <Link className="card" href="/portal/learning" style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ fontWeight: 700 }}>{t("performance.diveDev")}</div>
            <div className="muted small mt-1">{t("performance.diveDevHint")}</div>
          </Link>
          <Link className="card" href="/portal/staff" style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ fontWeight: 700 }}>{t("performance.diveStaff")}</div>
            <div className="muted small mt-1">{t("performance.diveStaffHint")}</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
