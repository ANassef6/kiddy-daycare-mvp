// KID-171 (D1): which invite affordance a family contact gets — one decision,
// one place.
//
// The child profile's "Pickup & family contacts" tab used to derive its button
// from two booleans that could not tell three states apart:
//
//   canSendInvite = !showActivation && !inviteId && isValidInviteEmail(email)
//
// `showResendForContact` is `activation.get(email)?.unactivated === true`, so it
// is false both when **no account exists** and when the account **exists and is
// confirmed**. Those two collapsed into one branch, so a parent who had signed
// in and was already active fell through to `SendInviteButton` and the admin was
// offered a second activation for a working login (KID-148 QA, production
// 2026-10-03). The missing test was "is there an account row at all", not "is it
// unconfirmed" — `activationByEmails` returns an entry for every account,
// confirmed or not, and only `unactivated` was ever read.
//
// This resolver reads account presence and confirmation as the two separate
// signals they are, and returns one named state so the UI can render an
// explicit `activated` state instead of letting a button imply it. Pure: no
// database, so the three acceptance cases are unit-testable without a browser.
//
// Order matters. A confirmed account outranks a pending invite row: if the
// parent can already sign in, re-inviting them is the same bug wearing a
// different label (KID-148 saw `nouranhisham22@gmail.com` — a confirmed,
// child-resolving account — rendered "Resend invite").

import { isValidInviteEmail } from "./invite-email";

/** An `ActivationEntry` for this contact's email, or null when no account exists. */
export type ContactAccountState = { unactivated: boolean } | null | undefined;

export type ContactInviteState =
  /** Login exists, email confirmation still pending → resend the confirmation. */
  | { kind: "resend_activation"; email: string }
  /** Login exists and is confirmed → the parent is active. Nothing to send. */
  | { kind: "activated"; email: string }
  /** No login yet, invite row pending → resend the invite. */
  | { kind: "resend_invite"; email: string; inviteId: string }
  /** No login and no pending invite → one-click "Send invite". */
  | { kind: "send_invite"; email: string }
  /** No usable email: nothing to send anything to. */
  | { kind: "none" };

export function contactInviteState(input: {
  email?: string | null;
  /** `activation.get(email)` — an entry means an account row exists. */
  account?: ContactAccountState;
  pendingInviteId?: string | null;
}): ContactInviteState {
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!email) return { kind: "none" };

  const account = input.account ?? null;
  // Account exists but unconfirmed: the parent registered and never clicked
  // the link. Resending the confirmation is the only useful action.
  if (account?.unactivated) return { kind: "resend_activation", email };
  // Account exists and is confirmed. This is the case that used to render
  // "Send invite": the parent is already active, so there is no invite state
  // left to act on.
  if (account) return { kind: "activated", email };

  const inviteId = input.pendingInviteId ? String(input.pendingInviteId).trim() : "";
  if (inviteId) return { kind: "resend_invite", email, inviteId };
  if (isValidInviteEmail(email)) return { kind: "send_invite", email };
  return { kind: "none" };
}

/** True for states that must render no invite button at all. */
export function isSettledContactState(state: ContactInviteState): boolean {
  return state.kind === "activated" || state.kind === "none";
}