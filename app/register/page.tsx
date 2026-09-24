"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { registerAction } from "@/lib/actions";

// KID-111: the invite email / admin-forwarded activation link points here
// with ?code= so the parent never has to retype the invite code.
function RegisterForm() {
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const presetCode = searchParams.get("code") ?? "";
  // KID-115: invite links carry what the daycare already knows so invited
  // parents don't retype their own contact details. Values come from the
  // daycare's contact record, never from free input.
  const presetEmail = searchParams.get("email") ?? "";
  const presetName = searchParams.get("name") ?? "";

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <span className="brand">Kiddy</span>
      <h1 className="title mt-4">Activate your parent account</h1>
      <p className="subtitle">
        Parents are invited by their daycare — you can&apos;t sign up on your own.
        Enter the invite code your daycare gave you to set up your password.
      </p>
      <form
        className="card"
        action={async (fd) => {
          const res = await registerAction(fd);
          if (res?.error) setError(res.error);
        }}
      >
        {error && <p style={{ color: "#dc2626", marginBottom: 12 }}>{error}</p>}
        <div className="field">
          <label className="label">Invite code (from your daycare)</label>
          <input className="input" name="inviteCode" placeholder="e.g. SUNSHINE-1234" required defaultValue={presetCode} />
        </div>
        <div className="field">
          <label className="label">Full name</label>
          <input className="input" name="fullName" required defaultValue={presetName} />
        </div>
        <div className="field">
          <label className="label">Email</label>
          <input className="input" name="email" type="email" required defaultValue={presetEmail} />
        </div>
        <div className="field">
          <label className="label">Password</label>
          <input className="input" name="password" type="password" required />
        </div>
        <div className="field">
          <label className="label">PIN (optional — quick sign-in)</label>
          <input className="input" name="pin" type="password" inputMode="numeric" maxLength={6} />
        </div>
        <button className="btn btn-primary btn-block" type="submit">Activate account</button>
      </form>
      <p className="small mt-3"><a href="/login">Already have an account? Sign in</a></p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
