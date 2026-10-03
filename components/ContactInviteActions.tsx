// KID-171 (D1): the family-contact row's invite affordance.
//
// Presentational only: the state comes from `contactInviteState`
// (lib/contact-invite-state.ts) and this component maps it to exactly one
// outcome. The mapping used to be inline arithmetic in the child profile page,
// where a confirmed account and a missing account were indistinguishable — so an
// active parent was offered "Send invite". Keeping the mapping here makes each
// state assertable without a browser (tests/unit/kid171-*.test.ts).
//
// `activatedLabel` is passed in rather than imported from the i18n dictionaries
// so the caller owns the active locale.

import type { ContactInviteState } from "@/lib/contact-invite-state";
import ResendActivationButton from "./ResendActivationButton";
import ResendInviteButton from "./ResendInviteButton";
import SendInviteButton from "./SendInviteButton";

export default function ContactInviteActions({
  state,
  childId,
  relationship,
  activatedLabel,
}: {
  state: ContactInviteState;
  childId: string;
  relationship: string;
  activatedLabel: string;
}) {
  switch (state.kind) {
    case "resend_activation":
      return (
        <>
          <br />
          <ResendActivationButton email={state.email} />
        </>
      );
    case "resend_invite":
      return (
        <>
          <br />
          <ResendInviteButton inviteId={state.inviteId} />
        </>
      );
    case "send_invite":
      return (
        <>
          <br />
          <SendInviteButton childId={childId} email={state.email} relationship={relationship} />
        </>
      );
    case "activated":
      // KID-171: an explicit state, not the absence of a button. An activated
      // parent's contact now says so, so "no affordance" can never again be
      // read as "we forgot to check".
      return (
        <>
          <br />
          <span className="muted" data-testid="contact-activated" style={{ fontSize: 12 }}>
            {activatedLabel}
          </span>
        </>
      );
    default:
      return null;
  }
}