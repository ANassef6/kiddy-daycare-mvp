import { requireSession } from "@/lib/require";
import { listRooms, listInstitutes, listChildren } from "@/lib/store";
import { addRoomAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default function PortalRoomsPage() {
  requireSession();
  const institutes = listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const rooms = iid ? listRooms(iid) : [];
  const children = iid ? listChildren(iid) : [];

  return (
    <div>
      <h1 className="title">Rooms</h1>
      <form className="card mb-4" action={addRoomAction}>
        <div className="row">
          <div className="col field"><label className="label">Room name</label><input className="input" name="name" required placeholder="e.g. Toddlers" /></div>
          <div className="col field"><label className="label">Capacity</label><input className="input" name="capacity" type="number" /></div>
          <div className="col" style={{ alignSelf: "flex-end" }}><button className="btn btn-primary" type="submit">Add room</button></div>
        </div>
      </form>

      <div className="grid">
        {rooms.map((r: any) => (
          <div className="card" key={r.id}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{r.name}</div>
            <div className="muted small">Capacity: {r.capacity ?? "—"}</div>
            <div className="small mt-2">
              {children.filter((c) => c.room_id === r.id).length} children
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
