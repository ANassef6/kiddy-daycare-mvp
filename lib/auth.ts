import crypto from "crypto";
import { queryGet, queryRun, type Row } from "./db";
import { ROLES } from "./role";
import { PLATFORM_OPERATOR_ROLE } from "./platform";

const COOKIE = "kiddy_sess";
// KID-686: an env var can carry an EMPTY string. `??` does not fall back on ""
// (only null/undefined), so a deployment whose SESSION_SECRET is set-but-empty
// silently signed every session with the publicly-known empty-key HMAC. `||`
// guarantees a non-empty signing key; production additionally gets one loud
// startup warning (KID-686: the prod project has had an empty SESSION_SECRET
// since Aug 2026, which also means rotating or first-setting the real secret
// invalidates every existing cookie exactly once — users log in again, the
// session then persists a full 30 days from that login).
const TOKEN_SECRET = process.env.SESSION_SECRET || "dev-only-secret-change-me";
let warnedSecret = false;
if (TOKEN_SECRET === "dev-only-secret-change-me" && !warnedSecret && process.env.NODE_ENV === "production") {
  warnedSecret = true;
  console.error(
    "KID-686: SESSION_SECRET is missing or empty in production — falling back to the public dev default. " +
    "Sessions still last 30 days, but the token signature is forgeable by anyone with account data. " +
    "Set a real SESSION_SECRET in the deploy env (a one-time global logout is expected on rotation)."
  );
}

type DbRow = Row & {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: string;
  pin: string | null;
  language: string;
  email_confirmed: number | null;
  // KID-495: 1 = the current password is a temporary credential the daycare
  // shared out-of-band; cleared on the first successful change-password.
  must_change_password: number | null;
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
  // KID-214: timingSafeEqual throws RangeError when buffer lengths differ — a
  // malformed token must fail closed (null), not crash the caller.
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    return null;
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
  // KID-236: present only on an operator-view session — the signed cookie the
  // operator-entry route mints after consuming a single-use grant. The signed
  // payload keeps the platform sentinel role; readers see the marker so tenant
  // resolution can bind the session to exactly one daycare host (lib/tenant.ts)
  // and layouts can render the "viewing as platform operator" banner. Sessions
  // without the marker behave byte-for-byte as before.
  operatorViewInstituteId?: string;
};

export function createSessionToken(session: Session): string {
  // KID-236: the operator-view marker must never flow into a 30-day session —
  // strip it here, so no code path can mint a long-lived operator-view token
  // through the regular session helpers. The 60-minute view cookie is minted
  // only by lib/operator-view.ts operatorViewSessionToken().
  const { operatorViewInstituteId: _stripMarker, ...rest } = session;
  return signToken({ ...rest, exp: Date.now() + 30 * 24 * 3600 * 1000 });
}

export function readSessionFromCookie(cookieHeader: string | null | undefined): Session | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|\\s)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const data = verifyToken(decodeURIComponent(m[1]));
  if (!data || (typeof data.exp === "number" && data.exp < Date.now())) return null;
  // KID-236: an operator-view token stores the platform sentinel role plus the
  // bound institute. Readers get the marker AND the daycare's admin effective
  // role, so the operator can actually use the daycare's admin surfaces —
  // while every tenancy decision keys off the marker, never off the effective
  // role. A marker without the sentinel role is ignored entirely (degrades to
  // the ordinary session rules — no new capability can be conjured by it).
  const marker =
    typeof data.operatorViewInstituteId === "string" ? data.operatorViewInstituteId : "";
  if (marker && String(data.role) === PLATFORM_OPERATOR_ROLE) {
    return {
      accountId: String(data.accountId),
      role: "admin",
      email: String(data.email),
      emailConfirmed: data.emailConfirmed === false ? false : true,
      operatorViewInstituteId: marker,
    };
  }
  return {
    accountId: String(data.accountId),
    role: String(data.role),
    email: String(data.email),
    emailConfirmed: data.emailConfirmed === false ? false : true,
  };
}

// KID-214: value-only reader. Next.js's cookies() store yields the bare cookie
// value, while readSessionFromCookie expects a raw `Cookie:` header that
// matches on `kiddy_sess=`. Passing the bare value to the header reader always
// returned null, killing the account-language fallback in the root layout.
export function readSessionFromCookieValue(value: string | null | undefined): Session | null {
  if (!value) return null;
  return readSessionFromCookie(`${COOKIE}=${value}`);
}

// KID-686: the 30-day persistent session cookie. `Secure` is added whenever
// the app runs in the deploy environment (production targets are always
// served over HTTPS there) — never in local dev, which must keep working
// over plain http://localhost. Every writer of the kiddy_sess cookie (the
// login server action, the /api/logout route, logoutAction, the operator
// entry/exit routes and these header builders) shares these attributes, so
// the suite pins the cookie surface exactly once.
export function sessionCookieSecureFlag(): boolean {
  return process.env.NODE_ENV === "production";
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: sessionCookieSecureFlag(),
    maxAge: maxAgeSeconds,
  };
}

export function sessionCookieHeader(session: Session): Record<string, string> {
  const value = createSessionToken(session);
  return {
    "Set-Cookie": `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax${sessionCookieSecureFlag() ? "; Secure" : ""}; Max-Age=${30 * 24 * 3600}`,
  };
}

export function clearSessionCookieHeader(): Record<string, string> {
  return {
    "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax${sessionCookieSecureFlag() ? "; Secure" : ""}; Max-Age=0`,
  };
}

// ---- account helpers ----
const ACCOUNT_SELECT = `id, email, password_hash, full_name, role, pin, language, auth_user_id, email_confirmed, must_change_password, created_at`;

export async function createAccount(data: {
  email: string;
  password: string;
  fullName: string;
  role?: string;
  pin?: string;
  language?: string;
  authUserId?: string | null;
  emailConfirmed?: boolean;
  // KID-495: set when the account is activated with a temporary password
  // shared out-of-band by the daycare.
  mustChangePassword?: boolean;
}): Promise<DbRow> {
  const id = crypto.randomUUID();
  // KID-199.4r: daycare accounts are created with real daycare roles only.
  // `superadmin` (and any other non-daycare value) can never be assigned
  // through this path. Two internal sentinel values stay mintable here for
  // the server's own unattended actors (lib/platform.ts operator, the hidden
  // "system" sweep actor in lib/store.ts) — they are never offered to or
  // assignable by any daycare surface.
  const effectiveRole = data.role ?? "parent";
  const internal = ["system", PLATFORM_OPERATOR_ROLE];
  const allowed =
    ROLES.includes(effectiveRole as (typeof ROLES)[number]) || internal.includes(effectiveRole);
  if (!allowed) throw new Error(`account-role-not-assignable: ${effectiveRole}`);
  await queryRun(
    `INSERT INTO account (id, email, password_hash, full_name, role, pin, language, auth_user_id, email_confirmed, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.email.toLowerCase(),
    hashPassword(data.password),
    data.fullName,
    effectiveRole,
    data.pin ? crypto.createHash("sha256").update(data.pin).digest("hex") : null,
    data.language ?? "en",
    data.authUserId ?? null,
    data.emailConfirmed === false ? 0 : 1,
    data.mustChangePassword ? 1 : 0
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

// KID-495: reads the temp-password flag off an account row (missing column /
// NULL on a legacy tree reads as "not flagged", never as a lock-out).
export function mustChangePasswordFor(account: DbRow | undefined): boolean {
  return !!account?.must_change_password;
}

// KID-495: flips the temp-password flag. UI guidance only — no session or
// permission change rides on it.
export async function setMustChangePassword(accountId: string, value: boolean): Promise<void> {
  await queryRun("UPDATE account SET must_change_password = ? WHERE id = ?", value ? 1 : 0, accountId);
}

// KID-495: replaces the stored password hash (hashPassword of the NEW
// password) and clears the temp-password flag — one write so callers cannot
// update the password while leaving the banner up.
export async function updateAccountPassword(accountId: string, newPassword: string): Promise<void> {
  await queryRun(
    "UPDATE account SET password_hash = ?, must_change_password = 0 WHERE id = ?",
    hashPassword(newPassword),
    accountId
  );
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

export async function setAccountLanguage(accountId: string, language: string): Promise<void> {
  await queryRun("UPDATE account SET language = ? WHERE id = ?", language, accountId);
}

export async function findAccountByEmail(email: string): Promise<DbRow | undefined> {
  return (await queryGet(`SELECT ${ACCOUNT_SELECT} FROM account WHERE email = ?`, email.toLowerCase())) as DbRow | undefined;
}

export async function getAccount(accountId: string): Promise<DbRow | undefined> {
  return (await queryGet(`SELECT ${ACCOUNT_SELECT} FROM account WHERE id = ?`, accountId)) as DbRow | undefined;
}

export async function accountProfile(accountId: string): Promise<{
  accountId: string;
  email: string;
  fullName: string;
  role: string;
  staffId?: string;
  photoUrl?: string | null;
}> {
  const row = await queryGet(
    `SELECT a.id, a.email, a.full_name, a.role, a.staff_id, s.photo_url
     FROM account a
     LEFT JOIN staff s ON s.id = a.staff_id
     WHERE a.id = ?`,
    accountId
  );
  return {
    accountId,
    email: row?.email ? String(row.email) : "",
    fullName: row?.full_name ? String(row.full_name) : "",
    role: row?.role ? String(row.role) : "",
    staffId: row?.staff_id ? String(row.staff_id) : undefined,
    photoUrl: row?.photo_url ? String(row.photo_url) : null,
  };
}

export async function staffIdForAccount(accountId: string): Promise<string | undefined> {
  const row = await queryGet("SELECT staff_id FROM account WHERE id = ?", accountId);
  return row?.staff_id ? String(row.staff_id) : undefined;
}

// ---- helpers for app router (read header) ----
export function sessionFromHeaders(headers: Headers): Session | null {
  const cookie = headers.get("cookie");
  return readSessionFromCookie(cookie);
}