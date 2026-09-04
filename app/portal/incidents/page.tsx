import { requireSession } from "@/lib/require";
import { listInstitutes, listIncidents } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PortalIncidentsPage() {
  requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const incidents = iid ? await listIncidents(iid) : [];

  return (
    <div>
      <h1 className="title">Incident reports</h1>
      {incidents.map((i: any) => (
        <div className="card mb-4" key={i.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="small muted">
              {capital(i.type)} · {i.first_name} {i.last_name} · {new Date(i.created_at).toLocaleString()} · reported by {i.reported_by}
            </div>
            <span className={i.acknowledged ? "badge badge-green" : "badge badge-red"}>
              {i.acknowledged ? "Parent acknowledged" : "Pending acknowledgement"}
            </span>
          </div>
          <p className="mt-2">{i.description}</p>
        </div>
      ))}
      {incidents.length === 0 && <p className="muted">No incidents logged.</p>}
    </div>
  );
}
function capital(s: unknown) { const v = String(s ?? ""); return v.charAt(0).toUpperCase() + v.slice(1); }
