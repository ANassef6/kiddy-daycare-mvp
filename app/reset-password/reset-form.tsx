"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { syncAppPasswordAfterResetAction } from "@/lib/actions";
import {
  completePasswordReset,
  establishRecoverySession,
  hasRecoveryCredentials,
  parseRecoveryParams,
  type RecoveryParams,
} from "@/lib/password-reset";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Status = "checking" | "ready" | "no-token" | "done" | "error";

export type ResetPasswordLabels = {
  title: string;
  checking: string;
  notConfigured: string;
  invalidLink: string;
  expiredLink: string;
  updateFailed: string;
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

function readRecoveryParams(): RecoveryParams {
  if (typeof window === "undefined") {
    return { accessToken: null, refreshToken: "", code: null };
  }
  return parseRecoveryParams(window.location.hash, window.location.search);
}

function clearRecoveryHash() {
  if (typeof window === "undefined" || !window.location.hash) return;
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search
  );
}

// KID-2400: the reset flow stays client-side (Supabase JS), but every
// visible string arrives as `labels` from the server page, which resolves
// the kiddy_lang cookie locale.
//
// KID-2441: ONE client now serves both the link check and the password
// write. Supabase's automatic URL detection (detectSessionInUrl) consumed and
// cleared the recovery fragment between them; the submit then used a second,
// session-less client and surfaced GoTrue's raw "Auth session missing".
// Detection is off, the parsed values are handed to lib/password-reset, and
// every failure resolves to a localized message.
export default function ResetPasswordForm({ labels }: { labels: ResetPasswordLabels }) {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<SupabaseClient | null>(null);
  const paramsRef = useRef<RecoveryParams>({ accessToken: null, refreshToken: "", code: null });

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
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      clientRef.current = supabase;

      const params = readRecoveryParams();
      paramsRef.current = params;
      if (!hasRecoveryCredentials(params)) {
        if (!cancelled) setStatus("no-token");
        return;
      }

      const setup = await establishRecoverySession(supabase, params);
      if (cancelled) return;
      if (!setup.ok) {
        console.error(
          "KID-2441 reset-password: recovery link could not establish a session:",
          setup.detail ?? setup.reason
        );
        setStatus(setup.reason === "no-token" ? "no-token" : "error");
        if (setup.reason !== "no-token") setMessage(labels.invalidLink);
        return;
      }
      setStatus("ready");
    }
    init().catch((err) => {
      console.error("KID-2441 reset-password: link check threw:", err instanceof Error ? err.message : err);
      if (!cancelled) {
        setStatus("error");
        setMessage(labels.invalidLink);
      }
    });
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
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setStatus("error");
      setMessage(labels.notConfigured);
      return;
    }

    const supabase =
      clientRef.current ??
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    clientRef.current = supabase;
    const params = paramsRef.current ?? readRecoveryParams();

    const result = await completePasswordReset(supabase, params, password);
    if (!result.ok) {
      console.error(
        "KID-2441 reset-password: password update failed:",
        result.reason,
        result.detail ?? ""
      );
      if (result.reason === "no-token") {
        setStatus("no-token");
        return;
      }
      if (result.reason === "expired" || result.reason === "invalid") {
        setStatus("error");
        setMessage(result.reason === "expired" ? labels.expiredLink : labels.invalidLink);
        return;
      }
      setError(labels.updateFailed);
      return;
    }

    clearRecoveryHash();

    // KID-495: sign-in falls back to the app-side hash when GoTrue is
    // unavailable, so the reset must reach account.password_hash too. The
    // reset-issued access token is the proof: the server re-verifies it
    // against GoTrue and only updates the hash for the same email.
    if (result.email && result.accessToken) {
      try {
        const syncOk = await syncAppPasswordAfterResetAction(result.email, password, result.accessToken);
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
          <p className="muted small">{message ?? labels.invalidLink}</p>
          <Link className="btn btn-primary mt-3" href="/forgot-password">{labels.requestNewLink}</Link>
        </div>
      )}

      <p className="small mt-3">
        <Link href="/login">{labels.backToSignin}</Link>
      </p>
    </div>
  );
}
