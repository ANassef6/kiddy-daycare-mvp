import { requireSession } from "@/lib/require";
import { listInstitutes, listConsents, listChildren } from "@/lib/store";
import { createConsentAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalConsentsPage() {
  requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const [consents, children] = await Promise.all([
    iid ? listConsents(iid) : Promise.resolve([]),
    iid ? listChildren(iid) : Promise.resolve([]),
  ]);

  return (
    <div>
      <h1 className="title">Consents</h1>
      <form className="card mb-4" action={createConsentAction}>
        <div className="row">
          <div className="col field"><label className="label">Title</label><input className="input" name="title" required /></div>
          <div className="col field"><label className="label">Child (optional)</label>
            <select className="select" name="childId">
              <option value="">All / general</option>
              {children.map((c: any) => <option key={c.id} value={String(c.id)}>{c.first_name} {c.last_name}</option>)}
            </select>
          </div>
        </div>
        <div className="field"><label className="label">Details</label><textarea className="textarea" name="body" /></div>
        <button className="btn btn-primary" type="submit">Send consent request</button>
      </form>

      {consents.map((c: any) => (
        <div className="list-item" key={c.id}>
          <div>
            <div style={{ fontWeight: 600 }}>{c.title}</div>
            <div className="muted small">{c.created_at ? new Date(c.created_at).toLocaleString() : ""}</div>
          </div>
          <span className={c.status === "approved" ? "badge badge-green" : c.status === "denied" ? "badge badge-red" : "badge"}>{c.status}</span>
        </div>
      ))}
    </div>
  );
}
