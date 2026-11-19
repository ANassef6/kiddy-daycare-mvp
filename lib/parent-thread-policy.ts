// KID-2449: who a parent may reply to inside an existing thread.
//
// KID-144 scoped every parent message by the target staff member's room
// assignment. That is right for a thread the parent opened, but it also ran on
// threads a staff member or admin opened with the parent: the founder
// (trois4ever+admin@gmail.com) messaged a parent and the parent's reply was
// refused with "you can only reply to a staff assigned to your children room",
// even though the admin was the person who started the conversation.
//
// The rule therefore branches on thread origin:
//   - parent-initiated thread: every other participant must be staff assigned
//     to the parent's children's rooms (the unchanged KID-144 rule).
//   - staff/admin-initiated thread: the parent may always reply, regardless of
//     room assignment, because an authorized staff side opened the conversation.
//
// This module is pure so the /child/messages page (what it offers) and
// `sendParentMessageAction` (what it accepts) share one rule and cannot drift.

const STAFF_SIDE_ROLES = new Set(["staff", "carer", "admin", "owner"]);

/** True when `role` is an account that may open a conversation with a parent. */
export function isStaffSideRole(role: unknown): boolean {
  return STAFF_SIDE_ROLES.has(String(role ?? "").trim().toLowerCase());
}

export interface ParentThreadAccess {
  /** The signed-in parent's account id. */
  viewerId: string;
  /** Every participant of the thread (including the viewer). */
  participantIds: string[];
  /** Role of the account that created the thread, or null for legacy rows. */
  creatorRole: string | null | undefined;
  /** Staff accounts assigned to the parent's children's rooms. */
  allowedStaffIds: ReadonlySet<string>;
}

/**
 * Whether this parent may read and reply inside this thread.
 *
 * A thread with no other participant is never usable (the parent would be
 * talking to themselves). A missing creator role (legacy threads) falls back to
 * the room rule, which is the safe direction.
 */
export function parentMayUseThread(access: ParentThreadAccess): boolean {
  const others = access.participantIds.filter((id) => id !== access.viewerId);
  if (others.length === 0) return false;
  if (isStaffSideRole(access.creatorRole)) return true;
  return others.every((id) => access.allowedStaffIds.has(id));
}
