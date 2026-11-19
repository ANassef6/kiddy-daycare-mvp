// KID-2441: password-recovery session handling.
//
// A Supabase recovery email lands on /reset-password with either:
//   - an implicit-grant fragment: #access_token=…&refresh_token=…&type=recovery
//   - a PKCE query parameter:     ?code=…
//
// The page used to create one Supabase client for the initial check and a
// SECOND client for the submit. Because the first client ran with
// detectSessionInUrl: true, its constructor consumed the fragment and called
// window.history/hash clearing — so the submit client saw no token, had no
// session, and updateUser() threw GoTrue's raw "Auth session missing".
//
// This module owns the URL parsing and session hand-off so the page can keep
// ONE client alive from link check to password write, and so every failure
// maps to a friendly, localized outcome instead of an auth exception.

export type RecoveryParams = {
  accessToken: string | null;
  refreshToken: string;
  code: string | null;
};

export type RecoveryAuthError = {
  message?: string | null;
  code?: string | null;
};

export type RecoveryAuthClient = {
  auth: {
    setSession(credentials: {
      access_token: string;
      refresh_token: string;
    }): Promise<{ error: RecoveryAuthError | null }>;
    exchangeCodeForSession(code: string): Promise<{ error: RecoveryAuthError | null }>;
    updateUser(attributes: {
      password: string;
    }): Promise<{
      data: { user: { email?: string | null } | null };
      error: RecoveryAuthError | null;
    }>;
    getSession(): Promise<{
      data: { session: { access_token?: string | null } | null };
    }>;
  };
};

export type RecoverySetupResult =
  | { ok: true }
  | { ok: false; reason: "no-token" | "invalid"; detail?: string };

export type PasswordResetResult =
  | { ok: true; email: string; accessToken: string }
  | {
      ok: false;
      reason: "no-token" | "invalid" | "expired" | "failed";
      detail?: string;
    };

/** Reads both implicit-fragment and PKCE query shapes from a recovery URL. */
export function parseRecoveryParams(hash: string, search: string): RecoveryParams {
  const hashBody = hash.startsWith("#") ? hash.slice(1) : hash;
  const searchBody = search.startsWith("?") ? search.slice(1) : search;
  const fragment = new URLSearchParams(hashBody);
  const query = new URLSearchParams(searchBody);

  return {
    accessToken: fragment.get("access_token") || query.get("access_token"),
    refreshToken: fragment.get("refresh_token") || query.get("refresh_token") || "",
    code: query.get("code") || fragment.get("code"),
  };
}

export function hasRecoveryCredentials(params: RecoveryParams): boolean {
  return !!(params.accessToken || params.code);
}

/**
 * Establishes the recovery session on the caller's client. The client must be
 * created with detectSessionInUrl: false so Supabase does not consume and clear
 * the URL fragment before this function reads it.
 */
export async function establishRecoverySession(
  client: RecoveryAuthClient,
  params: RecoveryParams
): Promise<RecoverySetupResult> {
  if (params.accessToken) {
    const { error } = await client.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });
    if (error) return { ok: false, reason: "invalid", detail: error.message ?? undefined };
    return { ok: true };
  }

  if (params.code) {
    const { error } = await client.auth.exchangeCodeForSession(params.code);
    if (error) return { ok: false, reason: "invalid", detail: error.message ?? undefined };
    return { ok: true };
  }

  return { ok: false, reason: "no-token" };
}

/**
 * Writes the new password through the session established from the recovery
 * link. Reuses an in-memory session when present (the one-client page path);
 * otherwise it re-establishes from the URL, which keeps a reloaded page usable
 * while the fragment is still in the address bar.
 */
export async function completePasswordReset(
  client: RecoveryAuthClient,
  params: RecoveryParams,
  password: string
): Promise<PasswordResetResult> {
  try {
    const existing = await client.auth.getSession();
    let accessToken = existing.data.session?.access_token ?? "";

    if (!accessToken) {
      const setup = await establishRecoverySession(client, params);
      if (!setup.ok) return { ok: false, reason: setup.reason, detail: setup.detail };
      const afterSetup = await client.auth.getSession();
      accessToken = afterSetup.data.session?.access_token ?? "";
    }

    const { data, error } = await client.auth.updateUser({ password });
    if (error) {
      return {
        ok: false,
        reason: isSessionMissingError(error) ? "expired" : "failed",
        detail: error.message ?? undefined,
      };
    }

    if (!accessToken) {
      const afterUpdate = await client.auth.getSession();
      accessToken = afterUpdate.data.session?.access_token ?? "";
    }

    return { ok: true, email: data.user?.email ?? "", accessToken };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: isSessionMissingError({ message: detail }) ? "expired" : "failed",
      detail,
    };
  }
}

/** True for the GoTrue shape behind "Auth session missing". */
export function isSessionMissingError(error: RecoveryAuthError | null | undefined): boolean {
  if (!error) return false;
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return (
    text.includes("auth session missing") ||
    text.includes("session_not_found") ||
    text.includes("session missing") ||
    text.includes("session not found")
  );
}
