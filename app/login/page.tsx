"use client";

import { useState } from "react";
import { loginAction } from "@/lib/actions";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <span className="brand">Kiddy</span>
      <h1 className="title mt-4">Sign in</h1>
      <p className="subtitle">Welcome back. Sign in to see your child&apos;s day.</p>
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
      <p className="muted small mt-3">
        Demo: admin@sunshinedaycare.test / kiddy-admin (portal) · parent@example.test / kiddy-parent (parent)
      </p>
      <p className="small mt-3">
        <a href="/register">New parent? Register with your invite</a>
      </p>
    </div>
  );
}
