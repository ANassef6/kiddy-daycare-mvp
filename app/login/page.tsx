"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loginAction } from "@/lib/actions";

// Friendlier messages for the guard redirects (KID-112 no_access, KID-86
// withdrawal, KID-199.3 disabled daycare) that land on /login?error=…
const GUARD_ERRORS: Record<string, string> = {
  withdrawn: "This account's access has been withdrawn.",
  disabled: "This account's access is currently disabled. Contact your daycare admin.",
  "disabled-institute": "This daycare is currently disabled. Contact the platform team.",
};

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [guardError, setGuardError] = useState<string | null>(null);
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null; primaryColor: string } | null>(null);

  // Fetch branding on mount and read query params (never during render)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("confirmed") === "1") setConfirmed(true);
    const guard = params.get("error");
    if (guard) setGuardError(GUARD_ERRORS[guard] ?? null);
    let cancelled = false;
    fetch("/api/branding")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setBrand(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        {brand?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt="" width={40} height={40} style={{ borderRadius: 10, objectFit: "cover" }} />
        )}
        <span className="brand">{brand?.name || "Kiddy"}</span>
      </div>
      <h1 className="title mt-4">Sign in</h1>
      <p className="subtitle">Welcome back. Sign in to see your daycare&apos;s day.</p>
      {guardError && !confirmed && (
        <div
          className="small"
          style={{
            background: "#fee2e2",
            border: "1px solid #dc2626",
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 16,
          }}
        >
          {guardError}
        </div>
      )}
      {confirmed && (
        <div
          className="small"
          style={{
            background: "#d1fae5",
            border: "1px solid #10b981",
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 16,
          }}
        >
          Your email is confirmed. You can now sign in.
        </div>
      )}
      <form
        className="card"
        action={async (fd) => {
          const res = await loginAction(fd);
          if (res?.error) setError(res.error);
        }}
      >
        {error && <p style={{ color: "#dc2626", marginBottom: 12 }}>{error}</p>}
        <div className="field">
          <label className="label">Email</label>
          <input className="input" name="email" type="email" required />
        </div>
        <div className="field">
          <label className="label">Password</label>
          <input className="input" name="password" type="password" required />
        </div>
        <button className="btn btn-primary btn-block" type="submit">Sign in</button>
      </form>
      <p className="small mt-3">
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p className="small mt-2">
        <Link href="/register">Have an invite code? Activate your account</Link>
      </p>
      <p className="muted small mt-3">
        Demo: admin@sunshinedaycare.test / kiddy-admin (portal) · parent@example.test / kiddy-parent (parent)
      </p>
    </div>
  );
}
