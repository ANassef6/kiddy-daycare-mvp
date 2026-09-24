"use client";

// KID-115: "Resend invite" affordance for contacts that have a pending invite
// but no login account yet (e.g. Becca nassef's parents). The GoTrue-based
// <ResendActivationButton/> correctly stays hidden for these contacts, so
// without this button the admin has no resend path on the child-detail page.
// Calls resendParentInviteAction (admin-invite channel) and confirms inline.

import { useState } from "react";
import { resendParentInviteAction } from "@/lib/actions";

export default function ResendInviteButton({ inviteId }: { inviteId: string }) {
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <span style={{ display: "inline-block" }}>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setStatus(null);
          const formData = new FormData();
          formData.set("inviteId", inviteId);
          const res = await resendParentInviteAction(formData);
          setBusy(false);
          if ((res as { ok?: boolean })?.ok) {
            setStatus({ ok: true, message: "Invite email sent." });
          } else {
            setStatus({
              ok: false,
              message: (res as { error?: string })?.error ?? "Could not send right now.",
            });
          }
        }}
        title="Resend the parent invite email"
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: busy ? "wait" : "pointer",
          color: "#dc2626",
          fontSize: 12,
          fontWeight: 600,
          textDecoration: "underline",
          textUnderlineOffset: 2,
        }}
      >
        {busy ? "Sending…" : "Resend invite"}
      </button>
      {status && (
        <span
          role="status"
          className="small"
          style={{
            display: "block",
            marginTop: 2,
            fontSize: 12,
            color: status.ok ? "#047857" : "#b45309",
          }}
        >
          {status.message}
        </span>
      )}
    </span>
  );
}
