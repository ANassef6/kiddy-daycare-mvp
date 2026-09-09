import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import { getRoom, roomChildren } from "@/lib/store";
import { updateRoomAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalRoomDetailPage({ params }: { params: { id: string } }) {
  requireSession();
  const room = await getRoom(params.id);
  if (!room) notFound();
  const children = await roomChildren(room.id);

  return (
    <div>
      <Link className="small muted" href="/portal/rooms">← Rooms</Link>
      <div className="row mt-2" style={{ alignItems: "center" }}>
        <span className="room-dot" style={{ background: String(room.colour ?? "#3B82F6"), width: 16, height: 16 }} />
        <h1 className="title" style={{ marginBottom: 0 }}>{room.name}</h1>
      </div>
      <p className="subtitle">Capacity: {room.capacity ?? "—"}</p>

      <div className="grid">
        <div className="card">
          <h3 className="subtitle">Assigned children</h3>
          {children.length === 0 ? (
            <p className="muted small">No children assigned to this room yet.</p>
          ) : (
            children.map((c: any) => (
              <div className="list-item" key={c.id}>
                <Link href={`/portal/children/${c.id}`} style={{ fontWeight: 600 }}>
                  {c.first_name} {c.last_name}
                </Link>
                <span className="muted small">{c.dob ?? ""}</span>
              </div>
            ))
          )}
          <div className="small muted mt-3">
            Assign a child to this room from the Children page when adding or editing a child.
          </div>
        </div>

        <div className="card">
          <h3 className="subtitle">Room settings</h3>
          <form action={updateRoomAction}>
            <input type="hidden" name="roomId" value={room.id as string} />
            <div className="field"><label className="label">Name</label><input className="input" name="name" required defaultValue={String(room.name)} /></div>
            <div className="field"><label className="label">Capacity</label><input className="input" name="capacity" type="number" defaultValue={String(room.capacity ?? "")} /></div>
            <div className="field"><label className="label">Colour</label><input className="input" name="colour" type="color" defaultValue={String(room.colour ?? "#3B82F6")} /></div>
            <button className="btn btn-primary" type="submit">Save settings</button>
          </form>
        </div>
      </div>
    </div>
  );
}