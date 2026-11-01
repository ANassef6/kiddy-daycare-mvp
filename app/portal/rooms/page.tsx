import Link from "next/link";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { requireSession } from "@/lib/require";
import { staffIdForAccount } from "@/lib/auth";
import { isAdminRole } from "@/lib/role";
import { listRooms, listChildren, staffRooms } from "@/lib/store";
import { addRoomAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-221: Rooms (sidebar Tools) used to ship entirely in English — heading,
// create form, capacity/children counts and the click hint. Localized; the
// "1 child" case now gets a proper singular form per locale.
export default async function PortalRoomsPage() {
  const session = requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const iid = await resolveTenantInstituteId();
  const allRooms = iid ? await listRooms(iid) : [];
  const children = iid ? await listChildren(iid) : [];

  // KID-105 #16: staff only see classrooms they are assigned to.
  let rooms = allRooms;
  if (!isAdminRole(session.role)) {
    const myStaffId = await staffIdForAccount(session.accountId);
    if (myStaffId) {
      const assigned = await staffRooms(myStaffId);
      const allowed = new Set(assigned.map((r) => String(r.id)));
      rooms = allRooms.filter((r: any) => allowed.has(String(r.id)));
    } else {
      rooms = [];
    }
  }

  return (
    <div>
      <h1 className="title">{t("rooms.title")}</h1>
      {isAdminRole(session.role) && (
        <form className="card mb-4" action={addRoomAction}>
          <div className="row">
            <div className="col field"><label className="label">{t("rooms.roomName")}</label><input className="input" name="name" required placeholder={t("rooms.roomNamePlaceholder")} /></div>
            <div className="col field"><label className="label">{t("rooms.capacity")}</label><input className="input" name="capacity" type="number" /></div>
            <div className="col field"><label className="label">{t("rooms.colour")}</label><input className="input" name="colour" type="color" defaultValue="#3B82F6" style={{ height: 40, padding: 4 }} /></div>
            <div className="col" style={{ alignSelf: "flex-end" }}><button className="btn btn-primary" type="submit">{t("rooms.addRoom")}</button></div>
          </div>
        </form>
      )}

      <div className="grid">
        {rooms.map((r: any) => {
          const inRoom = children.filter((c) => c.room_id === r.id).length;
          return (
            <Link key={r.id} href={`/portal/rooms/${r.id}`} className="card room-card" style={{ color: "var(--color-text)", textDecoration: "none" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span className="room-dot" style={{ background: String(r.colour ?? "#3B82F6") }} />
                <span style={{ fontWeight: 700, fontSize: 18 }}>{r.name}</span>
              </div>
              <div className="muted small">{t("rooms.capacityOf", { n: r.capacity ?? "—" })}</div>
              <div className="small mt-2">
                {inRoom === 1 ? t("rooms.childCount") : t("rooms.childrenCount", { count: inRoom })}
              </div>
              <div className="small muted mt-2">{t("rooms.viewHint")}</div>
            </Link>
          );
        })}
        {rooms.length === 0 && <p className="muted small">{t("rooms.noRooms")}</p>}
      </div>
    </div>
  );
}
