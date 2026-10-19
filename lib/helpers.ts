// Tiny shared helpers used across parent + portal T5 pages.
import { familiesForAccount } from "./store";
import { resolveTenantInstituteId } from "./tenant";

// KID-199.3: session-aware tenancy. This used to be a "first institute in the
// table" query, which put every user — including the staff and parents of the
// second daycare — on the first daycare's data. Pages keep calling it with no
// arguments; the resolution now goes through lib/tenant.ts (staff → their
// daycare, parent → their tenancy, platform operator → none).
export async function firstInstituteId(): Promise<string> {
  return resolveTenantInstituteId();
}

export async function familyChildren(accountId: string): Promise<any[]> {
  return familiesForAccount(accountId);
}

export function cap(s: unknown): string {
  const v = String(s ?? "");
  return v.charAt(0).toUpperCase() + v.slice(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeJson<T = any>(v: unknown, fallback: T): T {
  if (!v) return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}

export function fmtDate(v: unknown): string {
  if (!v) return "—";
  try {
    return new Date(String(v)).toDateString();
  } catch {
    return String(v);
  }
}

export function fmtTime(v: unknown): string {
  if (!v) return "";
  try {
    return new Date(String(v)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(v);
  }
}