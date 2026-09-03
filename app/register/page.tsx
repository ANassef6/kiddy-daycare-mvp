"use client";

import { useState } from "react";
import { registerAction } from "@/lib/actions";

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <span className="brand">Kiddy</span>
      <h1 className="title mt-4">Register as a parent</h1>
      <p className="subtitle">Enter your invite code to link to your child&apos;s daycare.</p>
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
          <input className="input" name="inviteCode" placeholder="e.g. SUNSHINE-1234" />
        </div>
        <div className="field">
          <label className="label">Full name</label>
          <input className="input" name="fullName" required />
        </div>
        <div className="field">
          <label className="label">Email</label>
          <input className="input" name="email" type="email" required />
        </div>
        <div className="field">
          <label className="label">Password</label>
          <input className="input" name="password" type="password" required />
        </div>
        <div className="field">
          <label className="label">PIN (optional — quick sign-in)</label>
          <input className="input" name="pin" type="password" inputMode="numeric" maxLength={6} />
        </div>
        <button className="btn btn-primary btn-block" type="submit">Create account</button>
      </form>
      <p className="small mt-3"><a href="/login">Already have an account? Sign in</a></p>
    </div>
  );
}
