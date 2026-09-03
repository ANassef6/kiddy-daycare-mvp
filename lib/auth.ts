import crypto from "crypto";
import { getDb } from "./db";
import type { NextApiRequest } from "next";
import type { NextRequest, NextResponse } from "next/server";

const COOKIE = "kiddy_sess";
const TOKEN_SECRET =
  process.env.SESSION_SECRET ?? "dev-only-secret-change-me";

type DbRow = { id: string; email: string; password_hash: string; full_name: string; role: string; pin: string | null; language: string };

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(pw, salt!, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash!), Buffer.from(check));
}

export function signToken(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

export type Session = {
  accountId: string;
  role: string;
  email: string;
};

export function createSessionToken(session: Session): string {
  return signToken({ ...session, exp: Date.now() + 30 * 24 * 3600 * 1000 });
}

export function readSessionFromCookie(cookieHeader: string | null | undefined): Session | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|\\s)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const data = verifyToken(decodeURIComponent(m[1]));
  if (!data || typeof data.exp === "number" && data.exp < Date.now()) return null;
  return {
    accountId: String(data.accountId),
    role: String(data.role),
    email: String(data.email),
  };
}

export function sessionCookieHeader(session: Session): Record<string, string> {
  const value = createSessionToken(session);
  return {
    "Set-Cookie": `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`,
  };
}

export function clearSessionCookieHeader(): Record<string, string> {
  return { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` };
}

// ---- account helpers ----
export function createAccount(data: {
  email: string;
  password: string;
  fullName: string;
  role?: string;
  pin?: string;
  language?: string;
}): DbRow {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO account (id, email, password_hash, full_name, role, pin, language)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.email.toLowerCase(),
    hashPassword(data.password),
    data.fullName,
    data.role ?? "parent",
    data.pin ? crypto.createHash("sha256").update(data.pin).digest("hex") : null,
    data.language ?? "en"
  );
  return db.prepare("SELECT * FROM account WHERE id = ?").get(id) as DbRow;
}

export function loginWithPin(pin: string, accountId: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT pin FROM account WHERE id = ?").get(accountId) as { pin: string | null } | undefined;
  if (!row?.pin) return false;
  const inputHash = crypto.createHash("sha256").update(pin).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(row.pin), Buffer.from(inputHash));
}

export function setPin(accountId: string, pin: string): void {
  getDb()
    .prepare("UPDATE account SET pin = ? WHERE id = ?")
    .run(crypto.createHash("sha256").update(pin).digest("hex"), accountId);
}

export function findAccountByEmail(email: string): DbRow | undefined {
  return getDb().prepare("SELECT * FROM account WHERE email = ?").get(email.toLowerCase()) as DbRow | undefined;
}

export function getAccount(accountId: string): DbRow | undefined {
  return getDb().prepare("SELECT * FROM account WHERE id = ?").get(accountId) as DbRow | undefined;
}

// ---- helpers for app router (read header) ----
export function sessionFromHeaders(headers: Headers): Session | null {
  const cookie = headers.get("cookie");
  return readSessionFromCookie(cookie);
}
