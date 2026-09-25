// Supabase client for auth. The app's data layer talks to Postgres directly
// (see lib/db.ts); Supabase GoTrue handles user registration/identity here.
// Fully optional: when unset, the app keeps its own password + session flow.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function supabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// KID-123: GoTrue reports an already-registered email on signUp with code
// `user_already_exists` (older projects: `email_exists`) and message "User
// already registered". The admin invite endpoint uses "already been
// registered". Pure helper so the register action (and unit tests) can match
// all variants without touching the network.
// KID-123: GoTrue reports an already-registered email on signUp with code
// `user_already_exists` (older projects: `email_exists`) and message "User
// already registered". The admin invite endpoint uses "already been
// registered". Pure helper so the register action (and unit tests) can match
// all variants without touching the network.
export function isGoTrueAlreadyRegisteredError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as Record<string, unknown>).code ?? "").toLowerCase();
  if (code === "user_already_exists" || code === "email_exists") return true;
  const message = String((err as Record<string, unknown>).message ?? "").toLowerCase();
  return message.includes("already registered") || message.includes("already been registered");
}

// KID-124: GoTrue server-side failures (HTTP 5xx, e.g. a corrupt auth.users
// row making signUp/signIn throw) must read as a system error, not as a wrong
// password or a validation message. Pure helper so the register action (and
// unit tests) can tell "our sign-in service is down" apart from "your input
// was rejected" without touching the network.
export function isGoTrueServerError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    // A thrown non-object (TypeError from fetch, undici socket error, …)
    // means the request never got an answer — treat as a server error only
    // when it smells like transport, never for plain strings.
    if (err instanceof Error) {
      return /fetch|network|timeout|econn|socket|eai_again|connection/i.test(err.message);
    }
    return false;
  }
  const rec = err as Record<string, unknown>;
  const status = typeof rec.status === "number" ? rec.status : Number(rec.status ?? NaN);
  if (Number.isFinite(status)) return status >= 500;
  const code = String(rec.code ?? "").toLowerCase();
  if (code === "unexpected_failure" || code === "internal_error" || code === "bad_gateway") return true;
  return /fetch failed|failed to fetch|network request failed|service unavailable|internal server error/i.test(
    String(rec.message ?? "")
  );
}