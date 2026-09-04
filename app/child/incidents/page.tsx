import { requireSession } from "@/lib/require";
import { familiesForAccount, incidentsForChild } from "@/lib/store";
import { acknowledgeIncidentAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ParentIncidentsPage() {
  const session = requireSession();
  const families = await familiesForAccount(session.accountId);
  const incidents: any[] = [];
  for (const f of families) {
    for (const i of await incidentsForChild(f.id as string)) {
      incidents.push({ ...i, child: `${(f as any).first_name} ${(f as any).last_name}` });
    }
  }
  incidents.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  return (
    <div>
      <h1 className="title">Incident reports</h1>
      {incidents.length === 0 ? (
        <p className="muted">No incident reports for your children.</p>
      ) : (
        incidents.map((i: any) => (
          <div className="card mb-4" key={i.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="small muted">
                {capital(i.type)} · {i.child} · {new Date(i.created_at).toLocaleString()}
              </div>
              <span className={i.acknowledged ? "badge badge-green" : "badge badge-red"}>
                {i.acknowledged ? "Acknowledged" : "Pending acknowledgement"}
              </span>
            </div>
            <p className="mt-2">{i.description}</p>
            {!i.acknowledged && (
              <form action={acknowledgeIncidentAction} className="mt-3">
                <input type="hidden" name="id" value={i.id} />
                <button className="btn btn-accent" type="submit">Acknowledge</button>
              </form>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function capital(s: unknown) {
  const v = String(s ?? "");
  return v.charAt(0).toUpperCase() + v.slice(1);
}
