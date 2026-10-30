"use client";

import { useState } from "react";
import { loginAction } from "@/lib/actions";

// KID-368 (DEF-004): the login form keeps its client-side error state (the
// loginAction result) but renders localized labels. The action itself returns
// errors already worded in the visitor's language (lib/actions.ts gateLocale),
// so this component only displays what it receives.
export default function LoginForm({
  emailLabel,
  passwordLabel,
  submitLabel,
}: {
  emailLabel: string;
  passwordLabel: string;
  submitLabel: string;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="card"
      action={async (fd) => {
        const res = await loginAction(fd);
        if (res?.error) setError(res.error);
      }}
    >
      {error && <p style={{ color: "#dc2626", marginBottom: 12 }} dir="auto">{error}</p>}
      <div className="field">
        <label className="label">{emailLabel}</label>
        <input className="input" name="email" type="email" required />
      </div>
      <div className="field">
        <label className="label">{passwordLabel}</label>
        <input className="input" name="password" type="password" required />
      </div>
      <button className="btn btn-primary btn-block" type="submit">{submitLabel}</button>
    </form>
  );
}
