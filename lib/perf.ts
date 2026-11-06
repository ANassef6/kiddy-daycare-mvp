// KID-472: lightweight server timing logs, strictly opt-in. Set
// KIDDY_PERF_LOG=1 (server env) to emit one line per instrumented call; with
// the flag unset this compiles to a no-op and costs nothing. No APM
// dependency, no secrets logged.
export function perfEnabled(): boolean {
  return process.env.KIDDY_PERF_LOG === "1";
}

export async function withPerfTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!perfEnabled()) return fn();
  const started = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`[perf] ${label} took ${Date.now() - started}ms`);
  }
}
