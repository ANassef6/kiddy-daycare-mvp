# Parent → daycare messaging: what makes a centre messageable

**Status as of 2026-10-03 (KID-171).** `/child/messages` is empty for every parent in a
deployment where no staff record is both *linked to a login* and *assigned to a classroom*.
This is configuration, not a UI state, and this file is the repair.

## The rule, and why it is strict

`classroomStaffForParent` (`lib/store.ts`) resolves a parent's recipients with one join chain:

```
account a JOIN staff s ON s.id = a.staff_id
         JOIN staff_room sr ON sr.staff_id = s.id
         JOIN child c ON c.room_id = sr.room_id
         JOIN family_member fm ON fm.child_id = c.id
WHERE fm.account_id = <parent>
```

All four links must hold. Two things follow, and both were true in production before
KID-171:

- **A staff record with no login is invisible.** `addStaffAction` only creates the account
  when an email is supplied at creation time, so staff added without one are unreachable.
- **A staff record with a login but no classroom is invisible.** They are not anybody's
  recipient, by design — KID-144 scoped messaging to the classroom so a parent cannot reach
  an unrelated admin. Do not relax this rule; it is a privacy boundary, not a bug.

Production carried **zero** rows matching that chain, so parent → daycare messaging was 100%
unavailable deployment-wide while `/child/messages` correctly reported "No staff are
available to message yet" (KID-169).

## Repairing a centre

1. Sign in as an admin and open **Staff**. Every row shows either its login email or
   `No login yet`. A row reading `No login yet` cannot be messaged by any parent.
2. Open that staff member. If they have no login, the **Portal login** card on their profile
   takes an email and a password (min 8 characters) and links the login to the existing staff
   record (KID-171 `linkStaffLoginAction`). It never re-points an account that already belongs
   to a different staff record — that case is refused with `That email already belongs to a
   different staff member`.
3. Assign their classrooms with **Edit basic info → Room access**. A login with no classroom
   is still not a recipient.
4. Confirm as a parent of a child in that room: `/child/messages` now lists the staff member
   in the `to` picker.

Step 2 can also be done at creation time: **Add staff** with an email creates the linked
login in one step. The repair path above exists for staff who were created without one.

## Fresh deployments

`lib/seed.ts` links the seeded owner login to its Maria Lopez staff record, which is assigned
to Toddlers and Preschool — so a freshly seeded centre is messageable from the first request.
Before KID-171 the seed created the staff record and the login separately and never joined
them, which is why every deployment reproduced the same empty messaging page.

`ensureSeeded` only seeds an empty database, so **deploying does not repair an existing
centre**; the repair is steps 1–4 above.

## Read-only diagnosis

```sql
-- Who can a parent in each room message? Any parent here with zero rows is blocked.
SELECT DISTINCT a.email, s.full_name, s.role, r.name AS classroom
FROM account a
JOIN staff s ON s.id = a.staff_id
JOIN staff_room sr ON sr.staff_id = s.id
JOIN room r ON r.id = sr.room_id
ORDER BY classroom, a.email;

-- Staff records no parent can reach, with the reason.
SELECT s.full_name, s.role,
       CASE WHEN a.id IS NULL THEN 'no login linked'
            WHEN sr.staff_id IS NULL THEN 'no classroom assigned'
            ELSE 'reachable' END AS state
FROM staff s
LEFT JOIN account a ON a.staff_id = s.id
LEFT JOIN staff_room sr ON sr.staff_id = s.id
GROUP BY s.id, a.id
ORDER BY state, s.full_name;
```

## Tests

`tests/unit/kid171-parent-contact-and-messaging.test.tsx` — a seeded centre offers its linked
staff, a message to an offered recipient is stored and received, the link-login action turns an
invisible staff record into an offered one, and it refuses to steal another staff member's
account. `tests/unit/kid169-parent-messaging-recipients.test.ts` holds the offered-set equals
accepted-set contract.