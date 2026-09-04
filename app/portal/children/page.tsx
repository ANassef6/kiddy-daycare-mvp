import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listChildren, listRooms, listInstitutes } from "@/lib/store";
import { addChildAction, inviteParentAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalChildrenPage() {
  requireSession();
  const institutes = await listInstitutes();
  const instituteId = institutes[0]?.id as string | undefined;
  const [children, rooms] = await Promise.all([
    instituteId ? listChildren(instituteId) : Promise.resolve([]),
    instituteId ? listRooms(instituteId) : Promise.resolve([]),
  ]);

  return (
    <div>
      <h1 className="title">Children</h1>
      <form className="card mb-4" action={addChildAction}>
        <h3 className="subtitle">Add a child</h3>
        <div className="row">
          <div className="col field"><label className="label">First name</label><input className="input" name="firstName" required /></div>
          <div className="col field"><label className="label">Last name</label><input className="input" name="lastName" required /></div>
        </div>
        <div className="row">
          <div className="col field"><label className="label">Date of birth</label><input className="input" name="dob" type="date" /></div>
          <div className="col field">
            <label className="label">Room</label>
            <select className="select" name="roomId">
              <option value="">— select —</option>
              {rooms.map((r) => <option key={r.id} value={String(r.id)}>{String(r.name)}</option>)}
            </select>
          </div>
          <div className="col field"><label className="label">Allergies</label><input className="input" name="allergies" /></div>
        </div>
        <button className="btn btn-primary" type="submit">Add child</button>
      </form>

      <table className="data">
        <thead>
          <tr><th>Name</th><th>Room</th><th>DOB</th><th>Health</th><th></th></tr>
        </thead>
        <tbody>
          {children.map((c: any) => (
            <tr key={c.id}>
              <td><Link href={`/portal/children/${c.id}`}><strong>{c.first_name} {c.last_name}</strong></Link></td>
              <td>{c.room_name ?? "—"}</td>
              <td>{c.dob ?? "—"}</td>
              <td className="small">{c.allergies ? `Allergies: ${c.allergies}` : "—"}</td>
              <td><Link className="btn btn-ghost small" href={`/portal/children/${c.id}`}>Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="title mt-5">Invite a parent</h2>
      <form className="card" action={inviteParentAction}>
        <div className="row">
          <div className="col field">
            <label className="label">Child (optional)</label>
            <select className="select" name="childId">
              <option value="">— any —</option>
              {children.map((c: any) => <option key={c.id} value={String(c.id)}>{c.first_name} {c.last_name}</option>)}
            </select>
          </div>
          <div className="col field"><label className="label">Parent email</label><input className="input" name="email" type="email" required /></div>
          <div className="col field"><label className="label">Invite code</label><input className="input" name="code" required placeholder="e.g. SUNSHINE-1234" /></div>
        </div>
        <button className="btn btn-accent" type="submit">Send invite</button>
      </form>
    </div>
  );
}
