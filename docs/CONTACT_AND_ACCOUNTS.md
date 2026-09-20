# Kiddy — contact submissions & account access (Round 5)

_Last updated 2026-09-17 (KID-46, founder feedback batch #2)._

## Where demo / inquiry submissions go

1. A visitor submits the **Book a demo** form on the public site (`/contact`).
2. `submitContactAction` (`lib/actions.ts`) writes one row to the **`contact_request`**
   table in the Supabase Postgres database.
3. The daycare owner sees every row in the portal at **`/portal/inquiries`**
   (Portal → Tools → Inquiries), newest first, with a one-click **Reply** mailto
   link. The portal dashboard also shows a "Demo & inquiry requests" card.

There is **no outbound notification email yet** (SMTP is not wired on the
Supabase project). The portal inbox is the notification path for now. To read the
raw rows directly:

```sql
SELECT created_at, name, email, phone, role, interest, message
FROM contact_request
ORDER BY created_at DESC;
```

The public form is daycare-only. The parent role option was removed so new rows
are `role = 'center'`.

## Sign-in, invites and password resets

- **Parents never self-register.** The daycare creates the invite
  (`inviteParentAction`, generating a code such as `SUNSHINE-1234`). The parent
  opens `/register`, enters the invite code, and sets their password. Without a
  valid, still-pending invite code the account cannot be created.
- **Forgot / reset password** lives at `/forgot-password` (linked from `/login`).
  It calls Supabase Auth `resetPasswordForEmail`, which sends the recovery email
  and lands on `/reset-password` to set the new password. This works for users
  who have a Supabase (GoTrue) identity — parents who activated an invite and
  staff created with a login email.
- **Interim path when email can't be delivered** (no SMTP / non-routable demo
  addresses): the daycare admin issues a fresh invite code for a parent, or sets
  a new temporary password when adding a staff member. The UI says so explicitly.

## Staff credentials (#14)

The portal's **Staff → Add staff** form now takes a **login email** and a
**temporary password** (with a **Generate** button). Submitting:

1. Creates the staff record (`staff` table).
2. Creates a linked portal account (`account.email` + `account.password_hash`,
   `account.staff_id = staff.id`).
3. Best-effort creates the Supabase Auth identity so the staff member can later
   use **Forgot password** to choose their own password.

The admin shares the email + password with the staff member, who signs in at
`/login` and lands in the portal. Staff without a login email are listed as
"No login yet".

## Access withdrawal with a last date (KID-86 item 9)

Both **child** and **staff** profiles now have a **Last date** field in their
About / Registration section.

- For a **staff** member, the last date withdraws that staff account. On the
  date (or as soon as the system sees the date after it), the staff row is set
  to `active = 0` and the linked account can no longer sign in or load any
  portal/child page.
- For a **child**, the last date sets the child record to `status = 'withdrawn'`
  and `active = 0`. The child disappears from default lists, and a parent whose
  remaining linked children are all withdrawn is also blocked at sign-in and on
  every page load.

The mechanism is intentionally simple and does **not** require an external
scheduler:

1. `runWithdrawalSweep()` updates every row whose `last_date <= today`.
2. `isAccountAccessWithdrawn(accountId)` checks the account.
3. Both the **login action** and the authenticated **portal/child layouts**
   run these checks, so withdrawal takes effect automatically on the date even
   if the user already has a live session cookie.
