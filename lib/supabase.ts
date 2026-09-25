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
export function isGoTrueAlreadyRegisteredError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as Record<string, unknown>).code ?? "").toLowerCase();
  if (code === "user_already_exists" || code === "email_exists") return true;
  const message = String((err as Record<string, unknown>).message ?? "").toLowerCase();
  return message.includes("already registered") || message.includes("already been registered");
}