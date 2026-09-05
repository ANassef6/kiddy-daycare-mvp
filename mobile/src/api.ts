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

let token: string | null = null;

export function hasSession(): boolean {
  return token !== null;
}

export function clearSession(): void {
  token = null;
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