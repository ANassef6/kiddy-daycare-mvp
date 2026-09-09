import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listRooms, listInstitutes, listChildren } from "@/lib/store";
import { addRoomAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalRoomsPage() {
  requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const [rooms, children] = await Promise.all([
    iid ? listRooms(iid) : Promise.resolve([]),
    iid ? listChildren(iid) : Promise.resolve([]),
  ]);

  return (
    <div>
      <h1 className="title">Rooms</h1>
      <form className="card mb-4" action={addRoomAction}>
        <div className="row">
          <div className="col field"><label className="label">Room name</label><input className="input" name="name" required placeholder="e.g. Toddlers" /></div>
          <div className="col field"><label className="label">Capacity</label><input className="input" name="capacity" type="number" /></div>
          <div className="col field"><label className="label">Colour</label><input className="input" name="colour" type="color" defaultValue="#3B82F6" style={{ height: 40, padding: 4 }} /></div>
          <div className="col" style={{ alignSelf: "flex-end" }}><button className="btn btn-primary" type="submit">Add room</button></div>
        </div>
      </form>

      <div className="grid">
        {rooms.map((r: any) => (
          <Link key={r.id} href={`/portal/rooms/${r.id}`} className="card room-card" style={{ color: "var(--color-text)", textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className="room-dot" style={{ background: String(r.colour ?? "#3B82F6") }} />
              <span style={{ fontWeight: 700, fontSize: 18 }}>{r.name}</span>
            </div>
            <div className="muted small">Capacity: {r.capacity ?? "—"}</div>
            <div className="small mt-2">
              {children.filter((c) => c.room_id === r.id).length} children
            </div>
            <div className="small muted mt-2">Click to view &amp; edit settings →</div>
          </Link>
        ))}
        {rooms.length === 0 && <p className="muted small">No rooms yet.</p>}
      </div>
    </div>
  );
}