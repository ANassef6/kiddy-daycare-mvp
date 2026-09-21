"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { confirmEmailAction } from "@/lib/actions";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Status = "checking" | "confirmed" | "no-token" | "error";

export default function AuthConfirmPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        if (!cancelled) {
          setStatus("error");
          setMessage("Email confirmation isn't configured in this environment.");
        }
        return;
      }

      const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true },
      });

      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token") ?? "";

      const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
      const code = query.get("code");
      const type = query.get("type") ?? "signup";

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (accessToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else {
          if (!cancelled) setStatus("no-token");
          return;
        }

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const email = userData.user?.email;
        if (!email) {
          throw new Error("Could not read the confirmed email address.");
        }

        await confirmEmailAction(email);

        if (!cancelled) {
          setStatus("confirmed");
          // Auto-redirect to login after a short delay so the user sees the success message.
          setTimeout(() => {
            if (typeof window !== "undefined") {
              window.location.href = `/login?confirmed=1&type=${encodeURIComponent(type)}`;
            }
          }, 1500);
        }
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setMessage(e instanceof Error ? e.message : "That confirmation link is no longer valid.");
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <span className="brand">Kiddy</span>
      <h1 className="title mt-4">Confirm your email</h1>

      {status === "checking" && <p className="subtitle">Checking your confirmation link…</p>}

      {status === "confirmed" && (
        <div className="card">
          <p className="muted small">Your email is confirmed. Redirecting you to sign in…</p>
          <Link className="btn btn-primary mt-3" href="/login?confirmed=1">
            Sign in now
          </Link>
        </div>
      )}

      {status === "no-token" && (
        <div className="card">
          <p className="muted small">
            This page completes an email-confirmation link. Open the link from your email, or sign in
            to resend it.
          </p>
          <Link className="btn btn-primary mt-3" href="/login">
            Sign in
          </Link>
        </div>
      )}

      {status === "error" && (
        <div className="card">
          <p className="muted small">{message}</p>
          <Link className="btn btn-primary mt-3" href="/login">
            Sign in
          </Link>
        </div>
      )}
    </div>
  );
}
