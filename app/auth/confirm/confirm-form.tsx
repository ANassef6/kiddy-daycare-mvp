"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { confirmEmailAction } from "@/lib/actions";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Status = "checking" | "confirmed" | "no-token" | "error";

export type AuthConfirmLabels = {
  brand: string;
  title: string;
  checking: string;
  notConfigured: string;
  invalidLink: string;
  noEmail: string;
  noSessionToken: string;
  confirmed: string;
  signInNow: string;
  signIn: string;
  noToken: string;
};

// KID-2400: the confirmation flow stays client-side (Supabase JS), but every
// visible string arrives as `labels` from the server page, which resolves
// the kiddy_lang cookie locale.
export default function AuthConfirmForm({ labels }: { labels: AuthConfirmLabels }) {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string | null>(null);

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
          throw new Error(labels.noEmail);
        }

        // KID-1175/F-07: the server action no longer trusts a bare email — it
        // verifies the confirmation session's access token against GoTrue
        // (and the matching email) before marking the local account
        // confirmed. Hand it the token from the session this link just
        // created; unverified calls change nothing server-side.
        const { data: sessionData } = await supabase.auth.getSession();
        const confirmationToken = sessionData.session?.access_token ?? "";
        if (!confirmationToken) {
          throw new Error(labels.noSessionToken);
        }

        await confirmEmailAction(email, confirmationToken);

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

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <span className="brand">{labels.brand}</span>
      <h1 className="title mt-4">{labels.title}</h1>

      {status === "checking" && <p className="subtitle">{labels.checking}</p>}

      {status === "confirmed" && (
        <div className="card">
          <p className="muted small">{labels.confirmed}</p>
          <Link className="btn btn-primary mt-3" href="/login?confirmed=1">
            {labels.signInNow}
          </Link>
        </div>
      )}

      {status === "no-token" && (
        <div className="card">
          <p className="muted small">{labels.noToken}</p>
          <Link className="btn btn-primary mt-3" href="/login">
            {labels.signIn}
          </Link>
        </div>
      )}

      {status === "error" && (
        <div className="card">
          <p className="muted small">{message}</p>
          <Link className="btn btn-primary mt-3" href="/login">
            {labels.signIn}
          </Link>
        </div>
      )}
    </div>
  );
}
