import { listChildren, listRooms, staffRooms } from "@/lib/store";
import { queryGet } from "@/lib/db";

// KID-2482 review follow-up: Events, Parent Drive, Homework, and Supplies all
// need the same classroom-aware recipients picker the newsfeed and activities
// composers use. This loader keeps the page-side wiring in one place: the
// visible children/rooms plus the staff member's assigned rooms (KID-2480
// scope). The server actions resolve the submitted audience with the shared
// resolver, so forged values are still dropped there.
export type PickerPerson = {
  id: string;
  first_name: string;
  last_name: string;
  room_id: string | null;
  room_name: string | null;
};

export type PickerData = {
  children: PickerPerson[];
  rooms: { id: string; name: string }[];
  assignedRoomIds: string[];
};

export async function recipientPickerData(
  instituteId: string,
  accountId: string,
  role: string
): Promise<PickerData> {
  const [children, rooms] = await Promise.all([
    listChildren(instituteId, { accountId }),
    listRooms(instituteId),
  ]);

  let assignedRoomIds: string[] = [];
  if (role === "staff" || role === "carer") {
    const me = await queryGet("SELECT staff_id FROM account WHERE id = ?", accountId);
    if (me?.staff_id) {
      const roomsForStaff = await staffRooms(String(me.staff_id));
      assignedRoomIds = roomsForStaff.map((r) => String(r.id));
    }
  }

  return {
    children: children.map((c: any) => ({
      id: String(c.id),
      first_name: String(c.first_name ?? ""),
      last_name: String(c.last_name ?? ""),
      room_id: c.room_id ? String(c.room_id) : null,
      room_name: c.room_name ? String(c.room_name) : null,
    })),
    rooms: rooms.map((r: any) => ({ id: String(r.id), name: String(r.name) })),
    assignedRoomIds,
  };
}
