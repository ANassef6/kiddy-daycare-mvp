import { NextRequest, NextResponse } from "next/server";
import { findAccountByEmail, verifyPassword, createSessionToken, emailConfirmedFor } from "@/lib/auth";
import { supabaseConfigured, getSupabase } from "@/lib/supabase";
import {
  authAttemptGuard,
  recordAuthFailure,
  recordAuthSuccess,
  clientIpFrom,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Mobile login. Mirrors the web's loginAction: prefers Supabase GoTrue when
// wired, then falls back to the app-side password verify + signed session —
// the path the web app actually uses on this deployment.
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  // KID-1178/F-06: the same brute-force gates as the web login — per-IP
  // attempt budget plus a per-account progressive lockout fed by verified
  // failures. The response mirrors the web's uniform rate-limit refusal
  // (json body + Retry-After; no account-existence hints).
  const ip = clientIpFrom(req.headers);
  const authGate = await authAttemptGuard("mobile-login", ip, email);
  if (!authGate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(authGate.retryAfterSec) } }
    );
  }

  // Primary path: Supabase GoTrue (reuses the web's own client).
  if (supabaseConfigured()) {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      const account = await findAccountByEmail(email);
      if (account) {
        const token = createSessionToken({
          accountId: account.id,
          role: account.role,
          email: account.email,
          emailConfirmed: emailConfirmedFor(account),
        });
        await recordAuthSuccess(email);
        return NextResponse.json({
          account: {
            id: account.id,
            email: account.email,
            role: account.role,
            fullName: account.full_name,
          },
          token,
        });
      }
    }
  }

  // Fallback: app-side verify (seeded demo accounts, or Supabase users whose
  // password was stored locally too). This is what loginAction relies on.
  const account = await findAccountByEmail(email);
  if (!account || !verifyPassword(password, account.password_hash)) {
    // KID-1178/F-06: a verified failure feeds the progressive lockout.
    await recordAuthFailure("mobile-login", ip, email);
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  await recordAuthSuccess(email);
  const token = createSessionToken({
    accountId: account.id,
    role: account.role,
    email: account.email,
    emailConfirmed: emailConfirmedFor(account),
  });
  return NextResponse.json({
    account: {
      id: account.id,
      email: account.email,
      role: account.role,
      fullName: account.full_name,
      emailConfirmed: emailConfirmedFor(account),
    },
    token,
  });
}