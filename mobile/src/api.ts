import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_ORIGIN } from "./config";
import type {
  BootstrapPayload,
  BillingPayload,
  ChildDetailPayload,
  ChildSummary,
  LoginBody,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// KID-686: the watched symptom — the app asked for email + password on EVERY
// cold start — was not a server-side session problem at all. The web app mints
// a 30-day signed session cookie and browsers (including the Android TWA's
// WebView) keep it without any client code. But the standalone RN app kept its
// bearer token in a module-level variable, i.e. in memory only: every process
// restart threw it away and the user had to sign in again. The token is now
// persisted in AsyncStorage (never the raw email/password — KID-686 forbids
// storing raw credentials) and restored on boot; an expired/revoked token
// still bounces to login through the existing 401 → clearSession path.
const SESSION_KEY = "kiddy.session.token";

export async function restoreSession(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(SESSION_KEY);
    if (stored) {
      token = stored;
      return true;
    }
  } catch {
    // Storage unavailable (private mode, corrupt state): stay signed out
    // rather than crash the boot sequence. No silent swallow of a login.
  }
  return false;
}

async function persistToken(value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(SESSION_KEY);
    else await AsyncStorage.setItem(SESSION_KEY, value);
  } catch (err) {
    // A failed persist never blocks the in-memory session the user just
    // earned: they stay signed in for this run, and next launch simply asks
    // again. Logged so the cause is never silent (AGENTS: no silent failures).
    console.log("KID-686 session persist failed:", err);
  }
}

let token: string | null = null;

export function hasSession(): boolean {
  return token !== null;
}

export function clearSession(): void {
  token = null;
  void persistToken(null);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_ORIGIN}${path}`, { ...init, headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in (body as object)
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const api = {
  async login(email: string, password: string): Promise<LoginBody> {
    const body = await request<LoginBody>("/api/mobile/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    token = body.token;
    await persistToken(token);
    return body;
  },

  async bootstrap(): Promise<BootstrapPayload> {
    return request<BootstrapPayload>("/api/mobile/bootstrap");
  },

  async child(id: string): Promise<ChildDetailPayload> {
    return request<ChildDetailPayload>(`/api/mobile/children/${encodeURIComponent(id)}`);
  },

  async checkInOut(id: string, type: "in" | "out"): Promise<ChildSummary> {
    return request<ChildSummary>(`/api/mobile/children/${encodeURIComponent(id)}/check-in`, {
      method: "POST",
      body: JSON.stringify({ type }),
    });
  },

  async billing(): Promise<BillingPayload> {
    return request<BillingPayload>("/api/mobile/billing");
  },
};
