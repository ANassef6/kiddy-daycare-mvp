import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import {
  getChild,
  listContacts,
  reportFor,
  incidentsForChild,
  todayStatus,
} from "@/lib/store";
import { saveDailyReportAction, addContactAction, createIncidentAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default function PortalChildPage({ params }: { params: { id: string } }) {
  requireSession();
  const child = getChild(params.id);
  if (!child) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const report = reportFor(child.id, today);
  const contacts = listContacts(child.id);
  const incidents = incidentsForChild(child.id);
  const status = todayStatus(child.id);
  const meal = safeJson(report?.meal);

  return (
    <div>
      <Link className="small muted" href="/portal/children">← Children</Link>
      <h1 className="title mt-1">{child.first_name} {child.last_name}</h1>
      <p className="subtitle">
        Room: {child.room_name ?? "—"} · Today:{" "}
        {status.lastEvent ? capital(status.lastEvent.type) : "not checked in yet"}
      </p>

      <div className="card mb-4">
        <h3 className="subtitle">Today&apos;s daily report</h3>
        <form action={saveDailyReportAction}>
          <input type="hidden" name="childId" value={child.id as string} />
          <input type="hidden" name="reportDate" value={today} />
          <div className="field">
            <label className="label">Summary</label>
            <textarea className="textarea" name="summary" defaultValue={String(report?.summary ?? "")} />
          </div>
          <div className="row">
            <div className="col field"><label className="label">Mood</label>
              <select className="select" name="mood" defaultValue={String(report?.mood ?? "")}>
                <option value="">—</option>
                <option value="happy">Happy</option><option value="okay">Okay</option>
                <option value="fussy">Fussy</option><option value="tired">Tired</option>
              </select>
            </div>
            <div className="col field"><label className="label">Sleep</label><input className="input" name="sleep" defaultValue={String(report?.sleep ?? "")} placeholder="12:30-14:00" /></div>
            <div className="col field"><label className="label">Diaper</label><input className="input" name="diaper" defaultValue={String(report?.diaper ?? "")} /></div>
          </div>
          <div className="row">
            <div className="col field"><label className="label">Breakfast</label><input className="input" name="breakfast" defaultValue={String(meal?.breakfast ?? "")} /></div>
            <div className="col field"><label className="label">Lunch</label><input className="input" name="lunch" defaultValue={String(meal?.lunch ?? "")} /></div>
            <div className="col field"><label className="label">Snack</label><input className="input" name="snack" defaultValue={String(meal?.snack ?? "")} /></div>
          </div>
          <div className="field"><label className="label">Observation (learning note)</label><textarea className="textarea" name="observation" defaultValue={String(report?.observation ?? "")} /></div>
          <div className="field"><label className="label">Note</label><input className="input" name="note" defaultValue={String(report?.note ?? "")} /></div>
          <label className="row" style={{ alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="sick" defaultChecked={!!report?.sick} /> <span>Mark as sick</span>
          </label>
          <div className="mt-3"><button className="btn btn-primary" type="submit">Save report</button></div>
        </form>
      </div>

      <div className="grid">
        <div className="card">
          <h3 className="subtitle">Pickup &amp; contacts</h3>
          {contacts.length === 0 ? <p className="muted small">None.</p> : null}
          {contacts.map((c: any) => (
            <div className="list-item" key={c.id}>
              <div className="small"><strong>{c.full_name}</strong> ({c.relationship})<br /><span className="muted">{c.phone}</span></div>
              <div>{c.is_pickup && <span className="badge">Pickup</span>}{c.is_emergency && <span className="badge badge-red">Emerg</span>}</div>
            </div>
          ))}
        </div>
        <div className="card">
          <h3 className="subtitle">Incidents</h3>
          {incidents.length === 0 ? <p className="muted small">None.</p> : null}
          {incidents.map((i: any) => (
            <div className="list-item small" key={i.id}>
              <div><strong>{capital(i.type)}</strong> — {new Date(i.created_at).toDateString()}<br /><span className="muted">{i.description}</span></div>
              <span className={i.acknowledged ? "badge badge-green" : "badge badge-red"}>{i.acknowledged ? "Acked" : "Open"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid mt-4">
        <div className="card">
          <h3 className="subtitle">Add contact</h3>
          <form action={addContactAction}>
            <input type="hidden" name="childId" value={child.id as string} />
            <div className="field"><label className="label">Full name</label><input className="input" name="fullName" required /></div>
            <div className="field"><label className="label">Relationship</label><input className="input" name="relationship" required /></div>
            <div className="field"><label className="label">Phone</label><input className="input" name="phone" /></div>
            <div className="field"><label className="label">Email</label><input className="input" name="email" /></div>
            <label className="row small" style={{ alignItems: "center", gap: 8 }}><input type="checkbox" name="isPickup" /> Authorized pickup</label>
            <label className="row small mt-2" style={{ alignItems: "center", gap: 8 }}><input type="checkbox" name="isEmergency" /> Emergency contact</label>
            <div className="mt-3"><button className="btn btn-ghost" type="submit">Add contact</button></div>
          </form>
        </div>
        <div className="card">
          <h3 className="subtitle">Log incident</h3>
          <form action={createIncidentAction}>
            <input type="hidden" name="childId" value={child.id as string} />
            <div className="field"><label className="label">Type</label>
              <select className="select" name="type"><option value="incident">Incident</option><option value="accident">Accident</option></select>
            </div>
            <div className="field"><label className="label">Description</label><textarea className="textarea" name="description" required /></div>
            <button className="btn btn-danger" type="submit">Log incident</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function safeJson(v: unknown): Record<string, string> {
  if (!v) return {};
  try { return JSON.parse(String(v)); } catch { return {}; }
}
function capital(s: unknown) { const v = String(s ?? ""); return v.charAt(0).toUpperCase() + v.slice(1); }
