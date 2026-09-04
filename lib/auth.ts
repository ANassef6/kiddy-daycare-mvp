import crypto from "crypto";
import { queryGet, queryRun, type Row } from "./db";

const COOKIE = "kiddy_sess";
const TOKEN_SECRET = process.env.SESSION_SECRET ?? "dev-only-secret-change-me";

type DbRow = Row & {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: string;
  pin: string | null;
  language: string;
  email_confirmed: number | null;
};

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
  emailConfirmed: boolean;
};

export function createSessionToken(session: Session): string {
  return signToken({ ...session, exp: Date.now() + 30 * 24 * 3600 * 1000 });
}

export function readSessionFromCookie(cookieHeader: string | null | undefined): Session | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|\\s)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const data = verifyToken(decodeURIComponent(m[1]));
  if (!data || (typeof data.exp === "number" && data.exp < Date.now())) return null;
  return {
    accountId: String(data.accountId),
    role: String(data.role),
    email: String(data.email),
    emailConfirmed: data.emailConfirmed === false ? false : true,
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
const ACCOUNT_SELECT = `id, email, password_hash, full_name, role, pin, language, auth_user_id, email_confirmed, created_at`;

export async function createAccount(data: {
  email: string;
  password: string;
  fullName: string;
  role?: string;
  pin?: string;
  language?: string;
  authUserId?: string | null;
  emailConfirmed?: boolean;
}): Promise<DbRow> {
  const id = crypto.randomUUID();
  await queryRun(
    `INSERT INTO account (id, email, password_hash, full_name, role, pin, language, auth_user_id, email_confirmed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.email.toLowerCase(),
    hashPassword(data.password),
    data.fullName,
    data.role ?? "parent",
    data.pin ? crypto.createHash("sha256").update(data.pin).digest("hex") : null,
    data.language ?? "en",
    data.authUserId ?? null,
    data.emailConfirmed === false ? 0 : 1
  );
  return (await queryGet(`SELECT ${ACCOUNT_SELECT} FROM account WHERE id = ?`, id)) as DbRow;
}

export async function setEmailConfirmed(accountId: string, confirmed: boolean): Promise<void> {
  await queryRun("UPDATE account SET email_confirmed = ? WHERE id = ?", confirmed ? 1 : 0, accountId);
}

export function emailConfirmedFor(account: DbRow | undefined): boolean {
  if (!account) return true;
  return account.email_confirmed !== 0;
}

export async function loginWithPin(pin: string, accountId: string): Promise<boolean> {
  const row = await queryGet("SELECT pin FROM account WHERE id = ?", accountId);
  if (!row?.pin) return false;
  const inputHash = crypto.createHash("sha256").update(pin).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(row.pin), Buffer.from(inputHash));
}

export async function setPin(accountId: string, pin: string): Promise<void> {
  await queryRun("UPDATE account SET pin = ? WHERE id = ?", crypto.createHash("sha256").update(pin).digest("hex"), accountId);
}

export async function findAccountByEmail(email: string): Promise<DbRow | undefined> {
  return (await queryGet(`SELECT ${ACCOUNT_SELECT} FROM account WHERE email = ?`, email.toLowerCase())) as DbRow | undefined;
}

export async function getAccount(accountId: string): Promise<DbRow | undefined> {
  return (await queryGet(`SELECT ${ACCOUNT_SELECT} FROM account WHERE id = ?`, accountId)) as DbRow | undefined;
}

// ---- helpers for app router (read header) ----
export function sessionFromHeaders(headers: Headers): Session | null {
  const cookie = headers.get("cookie");
  return readSessionFromCookie(cookie);
}