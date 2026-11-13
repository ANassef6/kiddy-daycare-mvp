"use client";

import { useState } from "react";
import { resendConfirmationAction } from "@/lib/actions";

// KID-2400: the labels resolve from the lib/i18n dictionary (resendConfirm.*
// + messages.sending) on the /welcome server page; the English defaults keep
// the component usable standalone.
export type ResendConfirmLabels = {
  resendBtn: string;
  sentMessage: string;
  fallbackError: string;
  sending: string;
};

const DEFAULT_LABELS: ResendConfirmLabels = {
  resendBtn: "Resend confirmation email",
  sentMessage: "Confirmation email sent. Check your inbox (and spam folder).",
  fallbackError: "Could not send the confirmation email right now.",
  sending: "Sending…",
};

export default function ResendConfirmButton({ labels = DEFAULT_LABELS }: { labels?: ResendConfirmLabels }) {
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <button
        className="btn btn-ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setStatus(null);
          const res = await resendConfirmationAction();
          setBusy(false);
          if (res?.ok) {
            setStatus({ ok: true, message: labels.sentMessage });
          } else {
            setStatus({ ok: false, message: res?.error ?? labels.fallbackError });
          }
        }}
      >
        {busy ? labels.sending : labels.resendBtn}
      </button>
      {status && (
        <p className="small mt-2" style={{ color: status.ok ? "#047857" : "#b45309" }}>
          {status.message}
        </p>
      )}
    </div>
  );
}
