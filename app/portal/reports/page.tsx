import { requireSession } from "@/lib/require";
import { listInstitutes, recentReports } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function PortalReportsPage() {
  requireSession();
  const institutes = listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const reports = iid ? recentReports(iid) : [];

  return (
    <div>
      <h1 className="title">Daily reports</h1>
      <table className="data">
        <thead><tr><th>Date</th><th>Child</th><th>Mood</th><th>Summary</th><th>Sick</th></tr></thead>
        <tbody>
          {reports.map((r: any) => (
            <tr key={r.id}>
              <td className="small">{new Date(String(r.report_date)).toDateString()}</td>
              <td><strong>{r.first_name} {r.last_name}</strong></td>
              <td>{capital(r.mood)}</td>
              <td className="small" style={{ maxWidth: 340 }}>{r.summary || "—"}</td>
              <td>{r.sick ? <span className="badge badge-red">Sick</span> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {reports.length === 0 && <p className="muted mt-3">No reports yet.</p>}
    </div>
  );
}
function capital(s: unknown) { const v = String(s ?? ""); if (!v) return "—"; return v.charAt(0).toUpperCase() + v.slice(1); }
