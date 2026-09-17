"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Status = "checking" | "ready" | "no-token" | "done" | "error";

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        if (!cancelled) {
          setStatus("error");
          setMessage("Password reset isn't configured in this environment.");
        }
        return;
      }
      const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true },
      });

      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token") ?? "";
      const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
      const code = query.get("code");

      try {
        if (accessToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          if (!cancelled) setStatus("no-token");
          return;
        }
        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setMessage(e instanceof Error ? e.message : "That reset link is no longer valid.");
        }
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(fd: FormData) {
    setError(null);
    const password = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    if (password.length < 6) {
      setError("Use at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true },
    });
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token") ?? "";
    if (accessToken) {
      await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setStatus("done");
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <span className="brand">Kiddy</span>
      <h1 className="title mt-4">Set a new password</h1>

      {status === "checking" && <p className="subtitle">Checking your reset link…</p>}

      {status === "ready" && (
        <form className="card" action={onSubmit}>
          {error && <p style={{ color: "#dc2626", marginBottom: 12 }}>{error}</p>}
          <div className="field">
            <label className="label">New password</label>
            <input className="input" name="password" type="password" required autoComplete="new-password" minLength={6} />
          </div>
          <div className="field">
            <label className="label">Confirm new password</label>
            <input className="input" name="confirm" type="password" required autoComplete="new-password" minLength={6} />
          </div>
          <button className="btn btn-primary btn-block" type="submit">Update password</button>
        </form>
      )}

      {status === "done" && (
        <div className="card">
          <p className="muted small">Your password has been updated.</p>
          <Link className="btn btn-primary mt-3" href="/login">Sign in</Link>
        </div>
      )}

      {status === "no-token" && (
        <div className="card">
          <p className="muted small">
            This page completes a password-reset link. Open the link from your
            email, or request a new one.
          </p>
          <Link className="btn btn-primary mt-3" href="/forgot-password">Request a reset link</Link>
        </div>
      )}

      {status === "error" && (
        <div className="card">
          <p className="muted small">{message}</p>
          <Link className="btn btn-primary mt-3" href="/forgot-password">Request a new link</Link>
        </div>
      )}

      <p className="small mt-3">
        <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
