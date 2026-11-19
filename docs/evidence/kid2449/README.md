# KID-2449 — parent can reply to staff/admin-initiated threads

## Root cause

`sendParentMessageAction` applied the KID-144 room rule to **every** parent
reply, including threads a staff/admin account had opened with the parent:

```
others.some((id) => !allowedIds.has(id))  → /child/messages?error=recipient
```

So when the company admin (`trois4ever+admin@gmail.com`) messaged a parent,
the parent's reply was refused with "you can only reply to a staff assigned to
your children room". The same room rule also hid staff/admin-initiated threads
from `threadsForAccountScoped`, so an unassigned admin thread could light a
notification the parent could not open, or open but not answer.

## What changed

| Area | File | Change |
|---|---|---|
| Thread policy | `lib/parent-thread-policy.ts` (new) | Pure `parentMayUseThread`: parent-initiated threads keep the room rule (every other participant is classroom-assigned staff); staff/admin/owner/carer-created threads are replyable regardless of room assignment. Legacy threads with no creator role fall back to the room rule. |
| Thread reads | `lib/store.ts` (`threadsForAccount`, `threadsForAccountScoped`, `threadForViewer`) | Thread rows carry the creator's `creator_role`; the scoped parent list and the reply guard share the policy module, so what the page offers and what the action accepts cannot drift. |
| Reply action | `lib/actions.ts` (`sendParentMessageAction`) | A refused thread reply redirects to `?error=thread-reply`; accepted replies fan out to the existing participants as before. New-conversation room scoping is unchanged. |
| Parent page | `app/child/messages/page.tsx` | The thread composer renders from the same policy, so a staff/admin-initiated thread is replyable even when the parent has no room-assigned staff in their recipient list. Blocked threads show a specific localized message instead of a composer that can only fail. |
| Copy | `lib/i18n.ts` | EN + AR `messages.sendFailedThread` and `messages.threadReplyBlocked`. |
| Tests | `tests/unit/kid2449-parent-reply.test.ts` (new), `tests/unit/kid171-parent-contact-and-messaging.test.tsx` | (a) admin-initiated → parent reply allowed and visible; (b) room teacher thread → parent reply allowed; (c) parent-initiated to non-assigned staff → blocked; (d) parent thread with an unrelated third party → blocked and hidden; (e) family role → `/child?error=role`. The KID-171 badge test now uses a non-staff thread creator for its hidden-thread case, matching the KID-2449 origin rule. |

## Expected behavior

- A parent can open and reply in any thread a staff member, admin, owner or
  carer started with them, even if that person has no classroom assignment.
- A parent cannot start a conversation with, or reply inside a parent-created
  thread containing, anyone outside their children's classroom staff.
- Family/pickup links still cannot message at all (read-only, KID-486).

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass |
| `next lint` | pass (existing `no-img-element` warnings only) |
| Messaging regression set: KID-2449, KID-171, KID-169, message threads, KID-472 messages, KID-182, KID-207, KID-1329 | 75/75 pass |
| Staging push | `staging` `7cfd63b`; Vercel `kiddy-staging` status `success` |
| Live staging flow (Skyvern) | owner/admin `founder.owner@staging.kiddy.test` (a staff record with **no room assignment**) sent a thread to `founder.parent@staging.kiddy.test`; the parent signed in, opened the thread, replied "KID2449 parent reply works" — the reply appears in the thread list and thread, with no "assigned to your child" error |

The staging owner fixture is the exact production shape: `createDaycare`
creates the owner's staff row with no rooms, so the owner is not in the
parent's `classroomStaffForParent` set. The parent's reply is therefore proof
of the staff/admin-origin branch, not of the unchanged room rule.

Evidence:

| File | State |
|---|---|
| `parent-thread-reply-form.png` | parent views the admin-opened thread with the reply composer |
| `parent-reply-sent.png` | parent's reply listed as the thread's last message |
| `parent-reply.html` | HTML scrape of the same state (contains the reply text) |

## Founder test script

Use the exact production accounts from the report. Run it after the staging
build shows `7cfd63b` or later.

1. Open `https://kiddy-staging-orcin.vercel.app/login` and sign in as the
   company admin `trois4ever+admin@gmail.com`.
2. Go to `/portal/messages?compose=1`. Send "KID-2449 admin test" to the parent
   `nouranhisham22@gmail.com` with group mode **off**.
3. Sign out. Sign in as `nouranhisham22@gmail.com`.
4. Open `/child/messages`. The admin thread must appear in **Your threads**.
5. Open it and reply "KID-2449 parent reply test". Press **Send**.

Pass criteria:

- The reply appears in the thread and as the thread's last message.
- No banner contains "assigned to your child", "Your message was not sent" or
  "Your reply was not sent".
- A new message from the parent to a staff member outside the child's rooms is
  still refused (unchanged rule).
- A family/pickup link still has no messaging surface (unchanged).
