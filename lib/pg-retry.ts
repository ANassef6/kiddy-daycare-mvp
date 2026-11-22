// KID-2452: Cloudflare Workers + Hyperdrive connection bootstrap.
//
// A Workers invocation can occasionally fail to establish the edge connection
// to Hyperdrive. The failure happens before any SQL runs, so retrying the
// *connect* is safe (it cannot replay a write). Query errors are never retried
// here: they propagate to the caller unchanged.

export type PgConnectable<T> = {
  connect(): Promise<T>;
};

export type ConnectRetryOptions = {
  /** Total attempts, including the first one. Defaults to 3. */
  attempts?: number;
  /** Base backoff in milliseconds; the delay grows linearly per attempt. */
  baseDelayMs?: number;
  /** Injectable sleeper so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Called after every failed attempt. `willRetry` is false on the last one. */
  onFailure?: (error: unknown, attempt: number, willRetry: boolean) => void;
};

export function describePgError(error: unknown): Record<string, unknown> {
  if (error === null || error === undefined) return { value: String(error) };
  if (typeof error !== "object") return { value: String(error) };
  const e = error as Record<string, unknown> & { cause?: unknown };
  const described: Record<string, unknown> = {
    name: e.name,
    message: e.message ?? "",
    code: e.code,
    errno: e.errno,
    syscall: e.syscall,
  };
  if (e.cause) {
    described.cause =
      e.cause && typeof e.cause === "object"
        ? (e.cause as Record<string, unknown>).message ?? String(e.cause)
        : String(e.cause);
  }
  return described;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function connectWithRetry<T>(
  pool: PgConnectable<T>,
  options: ConnectRetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 100);
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await pool.connect();
    } catch (error) {
      lastError = error;
      const willRetry = attempt < attempts;
      options.onFailure?.(error, attempt, willRetry);
      if (!willRetry) break;
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError;
}
