"use client";

import { useState } from "react";
import { resendConfirmationAction } from "@/lib/actions";

export default function ResendConfirmButton() {
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
            setStatus({ ok: true, message: "Confirmation email sent. Check your inbox (and spam folder)." });
          } else {
            setStatus({ ok: false, message: res?.error ?? "Could not send the confirmation email right now." });
          }
        }}
      >
        {busy ? "Sending…" : "Resend confirmation email"}
      </button>
      {status && (
        <p className="small mt-2" style={{ color: status.ok ? "#047857" : "#b45309" }}>
          {status.message}
        </p>
      )}
    </div>
  );
}