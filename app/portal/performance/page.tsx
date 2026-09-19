import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listStaff, staffActivity } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";

export const dynamic = "force-dynamic";

type MetricDef = { key: string; label: string; icon: string; accent: string };

const COMMUNICATION: MetricDef[] = [
  { key: "posts", label: "Posts", icon: "📝", accent: "#3B82F6" },
  { key: "media", label: "Media", icon: "🖼️", accent: "#8B5CF6" },
  { key: "messages", label: "Messages", icon: "💬", accent: "#F59E0B" },
];
const DEVELOPMENT: MetricDef[] = [
  { key: "observations", label: "Observations", icon: "🔭", accent: "#10B981" },
  { key: "assessments", label: "Assessments", icon: "📝", accent: "#EC4899" },
  { key: "twoYearChecks", label: "2 Years Checks", icon: "🧸", accent: "#06B6D4" },
];

export default async function PortalPerformancePage({
  searchParams,
}: {
  searchParams?: { staffId?: string; from?: string; to?: string };
}) {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
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
                  <div className="muted small">{def.label}</div>
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
      <h1 className="title">Performance indicators</h1>
      <div className="subtitle">Staff communication &amp; child-development activity over the selected period.</div>

      <div className="card mb-4">
        <form method="get" className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">Staff member</label>
            <select className="select" name="staffId" defaultValue={staffId ?? ""} style={{ minWidth: 220 }}>
              {staff.map((s: any) => (
                <option key={String(s.id)} value={String(s.id)}>{s.full_name}{s.role ? ` (${s.role})` : ""}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">From</label>
            <input className="input" type="date" name="from" defaultValue={from || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">To</label>
            <input className="input" type="date" name="to" defaultValue={to || new Date().toISOString().slice(0, 10)} />
          </div>
          <button className="btn btn-primary small" type="submit">Apply</button>
          <span className="small muted">Last updated {new Date().toLocaleString()}</span>
        </form>
      </div>

      {!activity ? (
        <p className="muted">Pick a staff member to see their indicators.</p>
      ) : (
        <div>
          <h3 className="subtitle">
            Communication — {activeStaff?.full_name ?? "Staff"}
            {from ? <span className="muted"> · since {from}</span> : ""}
            {to ? <span className="muted"> · until {to}</span> : ""}
          </h3>
          {renderBars(COMMUNICATION, { posts: "#3B82F6", media: "#8B5CF6", messages: "#F59E0B" })}

          <h3 className="subtitle mt-4">Child development — {activeStaff?.full_name ?? "Staff"}</h3>
          {renderBars(DEVELOPMENT, { observations: "#10B981", assessments: "#EC4899", twoYearChecks: "#06B6D4" })}
        </div>
      )}

      <div className="card mt-4">
        <h3 className="subtitle">Deep dives</h3>
        <div className="grid">
          <Link className="card" href={`/portal/report-center?staffId=${staffId}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ fontWeight: 700 }}>Report center</div>
            <div className="muted small mt-1">Generate and export center-wide reports.</div>
          </Link>
          <Link className="card" href="/portal/learning" style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ fontWeight: 700 }}>Development tracking</div>
            <div className="muted small mt-1">Review each child&apos;s learning milestones and goals.</div>
          </Link>
          <Link className="card" href="/portal/staff" style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ fontWeight: 700 }}>Staff &amp; access control</div>
            <div className="muted small mt-1">Manage the team behind the indicators.</div>
          </Link>
        </div>
      </div>
    </div>
  );
}