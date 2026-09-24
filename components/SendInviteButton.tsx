"use client";

// KID-115: one-click "Send invite" for contacts with no login and no pending
// invite yet. Creates the invite with a server-generated code and sends it
// through the admin-invite channel without leaving the page, then confirms
// the result inline (no navigation, no manual code entry).

import { useState } from "react";
import { sendInviteForContactAction } from "@/lib/actions";

export default function SendInviteButton({
  childId,
  email,
  relationship,
}: {
  childId: string;
  email: string;
  relationship: string;
}) {
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
          formData.set("childId", childId);
          formData.set("email", email);
          formData.set("relationship", relationship);
          const res = await sendInviteForContactAction(formData);
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
        title={`Send a parent invite email to ${email}`}
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
        {busy ? "Sending…" : "Send invite"}
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
