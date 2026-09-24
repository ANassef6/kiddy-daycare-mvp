"use client";

// KID-113: "Resend activation" affordance rendered next to the role for
// unactivated parent/staff accounts. The parent server component decides
// visibility (unactivated only); clicking resends the activation email via
// resendActivationAction and confirms the result to the admin inline.

import { useState } from "react";
import { resendActivationAction } from "@/lib/actions";

export default function ResendActivationButton({ email }: { email: string }) {
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
          formData.set("email", email);
          const res = await resendActivationAction(formData);
          setBusy(false);
          if ((res as { ok?: boolean })?.ok) {
            setStatus({ ok: true, message: "Activation email sent." });
          } else {
            setStatus({
              ok: false,
              message: (res as { error?: string })?.error ?? "Could not send right now.",
            });
          }
        }}
        title={`Resend the activation email to ${email}`}
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
        {busy ? "Sending…" : "Resend activation"}
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
