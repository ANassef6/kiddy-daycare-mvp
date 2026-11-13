"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { syncAppPasswordAfterResetAction } from "@/lib/actions";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Status = "checking" | "ready" | "no-token" | "done" | "error";

export type ResetPasswordLabels = {
  title: string;
  checking: string;
  notConfigured: string;
  invalidLink: string;
  tooShort: string;
  mismatch: string;
  newPassword: string;
  confirmPassword: string;
  updateBtn: string;
  done: string;
  signIn: string;
  noToken: string;
  requestLink: string;
  requestNewLink: string;
  backToSignin: string;
};

// KID-2400: the reset flow stays client-side (Supabase JS), but every
// visible string arrives as `labels` from the server page, which resolves
// the kiddy_lang cookie locale.
export default function ResetPasswordForm({ labels }: { labels: ResetPasswordLabels }) {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        if (!cancelled) {
          setStatus("error");
          setMessage(labels.notConfigured);
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
          setMessage(e instanceof Error ? e.message : labels.invalidLink);
        }
      }
    }
    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(fd: FormData) {
    setError(null);
    const password = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    if (password.length < 6) {
      setError(labels.tooShort);
      return;
    }
    if (password !== confirm) {
      setError(labels.mismatch);
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
    const { error: updateError, data: updateData } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      return;
    }
    // KID-495: sign-in falls back to the app-side hash when GoTrue is
    // unavailable, so the reset must reach account.password_hash too. The
    // reset-issued access token is the proof: the server re-verifies it
    // against GoTrue and only updates the hash for the same email.
    const email = updateData.user?.email ?? "";
    let proofToken = accessToken ?? "";
    if (!proofToken) {
      const { data: sessionData } = await supabase.auth.getSession();
      proofToken = sessionData.session?.access_token ?? "";
    }
    if (email && proofToken) {
      try {
        const syncOk = await syncAppPasswordAfterResetAction(email, password, proofToken);
        if (!syncOk.ok) {
          console.error("KID-495 reset-password: app-side hash sync failed:", syncOk.reason);
        }
      } catch (err) {
        console.error("KID-495 reset-password: app-side hash sync threw:", err instanceof Error ? err.message : err);
      }
    }
    setStatus("done");
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <span className="brand">Kiddy</span>
      <h1 className="title mt-4">{labels.title}</h1>

      {status === "checking" && <p className="subtitle">{labels.checking}</p>}

      {status === "ready" && (
        <form className="card" action={onSubmit}>
          {error && <p style={{ color: "#dc2626", marginBottom: 12 }}>{error}</p>}
          <div className="field">
            <label className="label">{labels.newPassword}</label>
            <input className="input" name="password" type="password" required autoComplete="new-password" minLength={6} />
          </div>
          <div className="field">
            <label className="label">{labels.confirmPassword}</label>
            <input className="input" name="confirm" type="password" required autoComplete="new-password" minLength={6} />
          </div>
          <button className="btn btn-primary btn-block" type="submit">{labels.updateBtn}</button>
        </form>
      )}

      {status === "done" && (
        <div className="card">
          <p className="muted small">{labels.done}</p>
          <Link className="btn btn-primary mt-3" href="/login">{labels.signIn}</Link>
        </div>
      )}

      {status === "no-token" && (
        <div className="card">
          <p className="muted small">{labels.noToken}</p>
          <Link className="btn btn-primary mt-3" href="/forgot-password">{labels.requestLink}</Link>
        </div>
      )}

      {status === "error" && (
        <div className="card">
          <p className="muted small">{message}</p>
          <Link className="btn btn-primary mt-3" href="/forgot-password">{labels.requestNewLink}</Link>
        </div>
      )}

      <p className="small mt-3">
        <Link href="/login">{labels.backToSignin}</Link>
      </p>
    </div>
  );
}
