// KID-1178/F-06: rate limiting and brute-force protection for the surfaces the
// KID-1170 assessment listed: web + mobile login, forgot-password, register,
// confirm-mail resend, invite/registration mail sends, messaging, uploads, and
// the push subscribe/test endpoints.
//
// Design:
// - One tiny counter engine (fixed windows, TTL'd keys) behind a store
//   interface. The durable backend is Upstash Redis over its REST API (no
//   client dependency, works on serverless/edge runtimes); when the env is not
//   wired the module falls back to an in-process store so single-instance
//   deployments are still protected. Either way the same rules run.
// - Authentication surfaces get per-IP attempt throttling AND a per-account
//   progressive lockout: thresholds of failures inside the window lock the
//   login for escalating durations (60s -> 120s -> 300s -> 15min cap); a
//   successful login clears the account counter. The lockout check does not
//   itself write, so failures-only counting cannot be skewed by successes.
// - Abuse surfaces (messaging/uploads/push) use per-account burst windows.
// - Fail-open on store outage: if the limiter itself cannot reach storage, the
//   request proceeds and the failure is logged — the platform never locks
//   everyone out because the gate broke (same posture as the KID-199.3
//   tenancy gate). Outages are visible in logs for monitoring.
// - Identities are hashed (sha256) before they become storage keys, so no
//   emails/IPs sit in Redis key space.
// - Every blocked decision logs one structured line (fmt=KID-1178/F-06).

import crypto from "crypto";

export type RateRule = { limit: number; windowSec: number };

export type RateDecision =
  | { ok: true; limit: number; windowSec: number }
  | { ok: false; rule: string; retryAfterSec: number; limit: number; windowSec: number };

const RULES = {
  // Auth surfaces — per-IP attempt budget (success + failure alike) and the
  // per-account failure lockout with progressive backoff.
  loginIp: { limit: 30, windowSec: 300 } as RateRule,
  loginAccount: {
    failureThreshold: 5,
    failureWindowSec: 900,
    // Index = how many full failure-thresholds have been crossed in the
    // current window (1 = first lockout, i.e. limit reached; then it doubles).
    backoffSteps: [60, 120, 300, 900],
  },
  passwordResetIp: { limit: 10, windowSec: 600 } as RateRule,
  passwordResetEmail: { limit: 3, windowSec: 600 } as RateRule,
  registerIp: { limit: 10, windowSec: 600 } as RateRule,
  confirmResendAccount: { limit: 3, windowSec: 600 } as RateRule,
  inviteAccount: { limit: 20, windowSec: 900 } as RateRule,
  inviteIp: { limit: 40, windowSec: 900 } as RateRule,
  contactIp: { limit: 10, windowSec: 600 } as RateRule,
  // Browser violation reports for the CSP report-only phase; browsers post
  // them unauthenticated, so the collector itself is throttled per IP.
  cspReportIp: { limit: 60, windowSec: 60 } as RateRule,

  // Abuse surfaces — per-account burst budgets.
  messagingAccount: { limit: 30, windowSec: 60 } as RateRule,
  uploadAccount: { limit: 20, windowSec: 300 } as RateRule,
  pushSubscribeAccount: { limit: 20, windowSec: 300 } as RateRule,
  pushTestAccount: { limit: 5, windowSec: 300 } as RateRule,
} as const;

export const RATE_LIMIT_RULES = RULES;

// ---------------------------------------------------------------------------
// Store

type MemoryEntry = { count: number; expiresAt: number };
type MemoryValue = { value: string; expiresAt: number };

interface RateLimitStore {
  readonly kind: string;
  incrFixedBucket(
    key: string,
    windowSec: number,
    opts: { getTtl?: boolean }
  ): Promise<{ count: number; ttlSec: number }>;
  // Re-reads a counter the engine previously incrFixedBuck under the same
  // key WITHOUT incrementing it (peeks must never skew the count).
  readCounter(key: string): Promise<number | null>;
  getNumber(key: string): Promise<number | null>;
  setNumber(key: string, value: number, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  clearAll?(): Promise<void>;
}

const PREFIX = "kid1178r";

function bucketStart(now: number, windowSec: number): number {
  return Math.floor(now / (windowSec * 1000));
}

class MemoryStore implements RateLimitStore {
  readonly kind = "memory";
  private buckets = new Map<string, MemoryEntry>();
  private values = new Map<string, MemoryValue>();

  async readCounter(key: string): Promise<number | null> {
    const entry = this.buckets.get(key);
    if (entry && Date.now() < entry.expiresAt) return entry.count;
    this.buckets.delete(key);
    return null;
  }

  async incrFixedBucket(key: string, windowSec: number, opts: { getTtl?: boolean }) {
    const now = Date.now();
    const full = key;
    let entry = this.buckets.get(full);
    if (!entry || now >= entry.expiresAt) {
      entry = { count: 0, expiresAt: now + windowSec * 1000 };
      this.buckets.set(full, entry);
    }
    entry.count += 1;
    const ttlSec = opts.getTtl ? Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)) : windowSec;
    this.pruneExpired(now);
    return { count: entry.count, ttlSec };
  }

  async getNumber(key: string): Promise<number | null> {
    const v = this.values.get(key);
    if (v && Date.now() < v.expiresAt) return Number(v.value);
    this.values.delete(key);
    return null;
  }

  async setNumber(key: string, value: number, ttlSec: number): Promise<void> {
    this.values.set(key, { value: String(value), expiresAt: Date.now() + ttlSec * 1000 });
  }

  async del(key: string): Promise<void> {
    this.buckets.delete(key);
    this.values.delete(key);
  }

  async clearAll(): Promise<void> {
    this.buckets.clear();
    this.values.clear();
  }

  private pruneExpired(now: number) {
    // Cheap: only sample the map head occasionally so long-lived processes do
    // not grow unbounded with one-shot keys.
    if (this.buckets.size < 5000 && this.values.size < 5000) return;
    for (const [k, e] of this.buckets) {
      if (now >= e.expiresAt) this.buckets.delete(k);
      else break;
    }
    for (const [k, v] of this.values) {
      if (now >= v.expiresAt) this.values.delete(k);
      else break;
    }
  }
}

class UpstashStore implements RateLimitStore {
  readonly kind = "upstash";
  constructor(private url: string, private token: string) {}

  private async cmd(commands: string[][]): Promise<unknown[] | null> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`upstash pipeline ${res.status}`);
    const json = (await res.json()) as Array<{ result: unknown } | null>;
    return json;
  }

  async incrFixedBucket(key: string, windowSec: number, opts: { getTtl?: boolean }) {
    const full = `${PREFIX}:${key}`;
    const commands: string[][] = [
      ["INCR", full],
      [
        "EXPIRE",
        full,
        String(windowSec + 1),
        "NX",
      ],
    ];
    if (opts.getTtl) commands.push(["TTL", full]);
    const out = await this.cmd(commands);
    if (!out) throw new Error("upstash empty pipeline");
    const count = Number((out[0] as { result: unknown })?.result ?? 0);
    const ttl = opts.getTtl ? Number((out[2] as { result: unknown })?.result ?? 0) : 0;
    return {
      count,
      ttlSec: ttl > 0 ? Math.min(ttl, windowSec) : windowSec,
    };
  }

  async readCounter(key: string): Promise<number | null> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/get/${PREFIX}:${key}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`upstash get ${res.status}`);
    const json = (await res.json()) as { result: string | null };
    return json.result === null ? null : Number(json.result);
  }

  async getNumber(key: string): Promise<number | null> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/get/${PREFIX}:${key}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`upstash get ${res.status}`);
    const json = (await res.json()) as { result: string | null };
    return json.result === null ? null : Number(json.result);
  }

  async setNumber(key: string, value: number, ttlSec: number): Promise<void> {
    const res = await fetch(
      `${this.url.replace(/\/$/, "")}/set/${PREFIX}:${key}/${value}?EX=${ttlSec}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}` },
      }
    );
    if (!res.ok) throw new Error(`upstash set ${res.status}`);
  }

  async del(key: string): Promise<void> {
    await fetch(`${this.url.replace(/\/$/, "")}/del/${PREFIX}:${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }
}

function resolveStore(): RateLimitStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && url.trim() !== "" && token && token.trim() !== "") {
    return new UpstashStore(url, token);
  }
  return new MemoryStore();
}

let _store: RateLimitStore | null = null;
export function rateLimitStore(): RateLimitStore {
  if (!_store) _store = resolveStore();
  return _store;
}

// Tests reset this through _resetRateLimitForTests.
export function _resetRateLimitForTests(): void {
  _store = null;
}

export function rateLimitBackend(): string {
  return rateLimitStore().kind;
}

// ---------------------------------------------------------------------------
// Identity helpers

export function hashIdentity(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

// The deployment runs behind proxies (Vercel / reverse proxy) that set
// X-Forwarded-For with the real client as the first entry; a caller-supplied
// spoofed list would have the real value appended, not prepended. Take the
// first entry only.
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "unknown";
}

function logThrottle(entry: Record<string, unknown>) {
  console.warn(JSON.stringify({ fmt: "KID-1178/F-06 rate_limited", ...entry }));
}

// ---------------------------------------------------------------------------
// Core fixed-window counter

async function incrWindow(
  name: string,
  identity: string,
  rule: RateRule,
  opts: { getTtl?: boolean } = {}
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const store = rateLimitStore();
  const key = `${name}:${identity}:${rule.windowSec}w${bucketStart(Date.now(), rule.windowSec)}`;
  let count = 0;
  let ttlSec = rule.windowSec;
  try {
    const r = await store.incrFixedBucket(key, rule.windowSec, opts);
    count = r.count;
    ttlSec = r.ttlSec || rule.windowSec;
  } catch (err) {
    // Fail-open: a limiter outage must not take the platform down with it.
    console.error(
      "KID-1178/F-06 rate-limit store failure (failing open, monitor this):",
      err instanceof Error ? err.message : err
    );
    return { allowed: true, retryAfterSec: 0 };
  }
  const allowed = count <= rule.limit;
  return { allowed, retryAfterSec: allowed ? 0 : Math.max(1, ttlSec) };
}

// Generic per-identity abuse window (used by messaging/uploads/push/register/…).
export async function throttle(
  surface: string,
  rule: RateRule,
  identityRaw: string
): Promise<RateDecision> {
  const identity = hashIdentity(identityRaw);
  const r = await incrWindow(surface, identity, rule, { getTtl: true });
  if (r.allowed) return { ok: true, limit: rule.limit, windowSec: rule.windowSec };
  logThrottle({
    surface,
    rule: `${rule.limit}/${rule.windowSec}s`,
    backend: rateLimitStore().kind,
    retryAfterSec: r.retryAfterSec,
    identity,
  });
  return {
    ok: false,
    rule: `${surface}:${rule.limit}/${rule.windowSec}s`,
    retryAfterSec: r.retryAfterSec,
    limit: rule.limit,
    windowSec: rule.windowSec,
  };
}

// Convenience for server actions: uniform localized error facilities are at
// the call site ({error: message}), the limiter stays framework-free.
export function rateLimitedMessageKey(): string {
  return "security.rateLimited";
}

// ---------------------------------------------------------------------------
// Auth: attempt budget (per IP) + progressive per-account lockout

export type AuthGuardResult =
  | { ok: true }
  | {
      ok: false;
      scope: "ip" | "account";
      retryAfterSec: number;
    };

const ACC_FAIL_PREFIX = "authfail";
const ACC_LAST_PREFIX = "authlast";

export async function authAttemptGuard(
  surface: string,
  ipRaw: string,
  emailRaw: string
): Promise<AuthGuardResult> {
  const store = rateLimitStore();
  const email = hashIdentity(emailRaw.trim().toLowerCase());

  // Peek the account lockout first — no writes, so counting is unaffected.
  try {
    const failures = await store.readCounter(`${ACC_FAIL_PREFIX}:${email}`);
    if (failures !== null && failures >= RULES.loginAccount.failureThreshold) {
      const lastAt = (await store.getNumber(`${ACC_LAST_PREFIX}:${email}`)) ?? 0;
      const rounds = Math.floor(failures / RULES.loginAccount.failureThreshold) - 1;
      const steps = RULES.loginAccount.backoffSteps;
      const step = steps[Math.min(rounds, steps.length - 1)] ?? steps[steps.length - 1];
      const blockedUntil = lastAt + step * 1000;
      const retryAfterSec = Math.ceil((blockedUntil - Date.now()) / 1000);
      if (retryAfterSec > 0) {
        logThrottle({
          surface,
          rule: "account-lockout",
          backend: store.kind,
          retryAfterSec,
          identity: email,
        });
        return { ok: false, scope: "account", retryAfterSec };
      }
    }
  } catch (err) {
    console.error(
      "KID-1178/F-06 rate-limit store failure (failing open, monitor this):",
      err instanceof Error ? err.message : err
    );
    return { ok: true };
  }

  // Per-IP attempt budget. Counted before credential verification; failures
  // below additionally feed the per-account lockout.
  const ip = hashIdentity(ipRaw);
  const attempt = await incrWindow("authip", ip, RULES.loginIp, { getTtl: true });
  if (!attempt.allowed) {
    logThrottle({
      surface,
      rule: `authip:${RULES.loginIp.limit}/${RULES.loginIp.windowSec}s`,
      backend: store.kind,
      retryAfterSec: attempt.retryAfterSec,
      identity: ip,
    });
    return { ok: false, scope: "ip", retryAfterSec: attempt.retryAfterSec };
  }
  return { ok: true };
}

export async function recordAuthFailure(
  surface: string,
  ipRaw: string,
  emailRaw: string
): Promise<void> {
  const store = rateLimitStore();
  const email = hashIdentity(emailRaw.trim().toLowerCase());
  try {
    const count = await store.incrFixedBucket(
      `${ACC_FAIL_PREFIX}:${email}`,
      RULES.loginAccount.failureWindowSec,
      { getTtl: false }
    );
    await store.setNumber(
      `${ACC_LAST_PREFIX}:${email}`,
      Date.now(),
      RULES.loginAccount.failureWindowSec
    );
    if (count.count >= RULES.loginAccount.failureThreshold) {
      // Log only when a new lockout tier is reached, so the log is monitorable
      // without flooding on every additional attempt inside a lockout.
    if (count.count % RULES.loginAccount.failureThreshold === 0) {
      logThrottle({
          surface,
          rule: "account-failure-threshold",
          backend: store.kind,
          retryAfterSec: RULES.loginAccount.backoffSteps[0],
          failures: count.count,
          identity: email,
        });
      }
    }
  } catch (err) {
    console.error(
      "KID-1178/F-06 rate-limit store failure on auth-failure record (failing open):",
      err instanceof Error ? err.message : err
    );
  }
}

export async function recordAuthSuccess(emailRaw: string): Promise<void> {
  const store = rateLimitStore();
  const email = hashIdentity(emailRaw.trim().toLowerCase());
  try {
    await store.del(`${ACC_FAIL_PREFIX}:${email}`);
    await store.del(`${ACC_LAST_PREFIX}:${email}`);
  } catch (err) {
    console.error(
      "KID-1178/F-06 rate-limit store failure on auth-success clear:",
      err instanceof Error ? err.message : err
    );
  }
}
