// Tiny shared helpers used across parent + portal T5 pages.
import { queryGet } from "./db";
import { familiesForAccount } from "./store";

export async function firstInstituteId(): Promise<string> {
  const row = await queryGet("SELECT id FROM institute ORDER BY created_at LIMIT 1");
  return String(row?.id ?? "");
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