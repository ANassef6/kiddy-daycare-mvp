// KID-169: the parent → daycare messaging recipient contract.
//
// The page that renders /child/messages and the server action that accepts the
// send must agree on exactly one rule: a parent may message the staff assigned
// to the rooms their own children sit in, and nothing else. While those two
// rules were written separately the page offered the centre's owner/admin
// account (chosen by `centerContactAccount`, which ignored its own institute
// argument and had no room predicate) and the action refused it 100% of the
// time — silently, because nothing rendered the refusal. Both sides now
// resolve their recipient set here, so they cannot drift apart again.

import { classroomStaffForParent } from "./store";
import type { Row } from "./db";

/**
 * The accounts a parent is allowed to message: staff assigned to the rooms
 * where this parent's children are enrolled. Single source of truth for the
 * /child/messages page (what it offers) and `sendParentMessageAction` (what it
 * accepts). Returns an empty list when nobody is assigned yet — the caller
 * must then say so instead of falling back to some other account.
 */
export async function parentMessageRecipients(accountId: string): Promise<Row[]> {
  return classroomStaffForParent(accountId);
}

/** The same set as ids, for the server-side membership check. */
export async function parentRecipientIds(accountId: string): Promise<Set<string>> {
  const recipients = await parentMessageRecipients(accountId);
  return new Set(recipients.map((r) => String(r.id)));
}

/**
 * Which recipient the page shows for the `to` request parameter. A requested id
 * outside the allowed set — forged, stale, or left over from a previous
 * session — is dropped rather than rendered, so the page can only ever offer a
 * recipient the server will accept. Falls back to the first allowed recipient
 * so the default case (no `to`) still yields a valid one, and returns
 * `undefined` when nobody is available to message.
 */
export function pickRecipient(recipients: Row[], requestedId?: string | null): Row | undefined {
  if (recipients.length === 0) return undefined;
  const wanted = String(requestedId ?? "").trim();
  if (!wanted) return recipients[0];
  return recipients.find((r) => String(r.id) === wanted) ?? recipients[0];
}

/**
 * KID-171 (D3): the unread total a parent can actually act on.
 *
 * `unreadCountForAccount` counts every unread message addressed to the account,
 * with no participant scoping, while `threadsForAccountScoped` drops any thread
 * whose other participants are not classroom-assigned staff. KID-169 wired the
 * /child/messages page to the scoped list and left the counter unscoped, so the
 * only thread a parent may not see was the only one that could light their
 * badge: the page read "Messages (1 unread)" above an empty list, and no click
 * anywhere could ever open or clear it.
 *
 * The badge is therefore summed from the threads the page actually lists, so the
 * number and the list cannot disagree. `threadsForAccount` already returns a
 * per-thread `unread_count`, so this costs no extra query.
 */
export function sumVisibleUnread(threads: Row[]): number {
  return threads.reduce((total, thread) => total + (Number(thread.unread_count ?? 0) || 0), 0);
}
