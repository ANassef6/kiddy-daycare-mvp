"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/lib/actions";
import AuthBrand from "@/components/AuthBrand";

// KID-437: the form stays client-side; the brand header is the shared
// AuthBrand, per-origin like /login — the server page (page.tsx) resolves the
// tenant's own name for the first paint, and the client fetch keeps it live
// (KID-368 acceptance).
export default function ForgotPasswordForm({ brandName }: { brandName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <AuthBrand brandName={brandName} />
      <h1 className="title mt-4">Reset your password</h1>
      <p className="subtitle">
        Enter the email you use to sign in and we&apos;ll send you a link to set a
        new password.
      </p>
      {sent ? (
        <div className="card">
          <h2 className="title" style={{ fontSize: 18 }}>Check your email</h2>
          <p className="muted small mt-1">
            If an account exists for that address, we sent a password-reset link.
            The link expires in one hour.
          </p>
          <p className="muted small mt-2">
            Didn&apos;t get it? Ask your daycare admin to send a new invite code,
            or try again.
          </p>
        </div>
      ) : (
        <form
          className="card"
          action={async (fd) => {
            const res = await requestPasswordResetAction(fd);
            if (res?.error) setError(res.error);
            else setSent(true);
          }}
        >
          {error && <p style={{ color: "#dc2626", marginBottom: 12 }}>{error}</p>}
          <div className="field">
            <label className="label">Email</label>
            <input className="input" name="email" type="email" required autoComplete="email" />
          </div>
          <button className="btn btn-primary btn-block" type="submit">Send reset link</button>
        </form>
      )}
      <p className="small mt-3">
        <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
