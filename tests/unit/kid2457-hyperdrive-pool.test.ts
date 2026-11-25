// KID-2457: the Workers entry used to call pool.end() as soon as the fetch
// handler resolved. OpenNext keeps rendering (and querying) after that point,
// so every late query rejected with "Cannot use a pool after calling end on
// the pool" — the empty-message variant of the same race in production.
//
// These tests pin the two halves of the fix: the per-request pool outlives the
// fetch handler, and a failed *connection* is retried once without ever
// re-running the statement.

import { describe, expect, it, vi } from "vitest";
import {
  acquireClientWithRetry,
  dbRequestStore,
  isRetryableConnectError,
  withRequestPool,
} from "@/lib/db-request";
import type { Pool, PoolClient } from "pg";

describe("KID-2457 per-request pool lifecycle", () => {
  it("leaves the pool open after the fetch handler resolves", async () => {
    const fakePool = { end: vi.fn(), connect: vi.fn() };
    let poolInScope: Pool | undefined;

    const result = await withRequestPool(
      { HYPERDRIVE: { connectionString: "postgres://u:p@hyperdrive.local/db?sslmode=disable" } },
      async () => {
        poolInScope = dbRequestStore.getStore()?.pool;
        return "rendered";
      },
      () => fakePool as unknown as Pool
    );

    expect(result).toBe("rendered");
    expect(poolInScope).toBe(fakePool);
    expect(fakePool.end).not.toHaveBeenCalled();
  });

  it("runs without a store when the deployment has no Hyperdrive binding", async () => {
    const createPool = vi.fn();
    const result = await withRequestPool({}, async () => "node-path", createPool);
    expect(result).toBe("node-path");
    expect(createPool).not.toHaveBeenCalled();
    expect(dbRequestStore.getStore()).toBeUndefined();
  });
});

describe("KID-2457 connect retry", () => {
  it("retries an empty-message connection failure exactly once", async () => {
    const client = { release: vi.fn() } as unknown as PoolClient;
    let attempts = 0;
    const pool = {
      connect: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("");
        return client;
      }),
    };

    const acquired = await acquireClientWithRetry(pool as Pick<Pool, "connect">, {
      sleep: async () => {},
    });

    expect(acquired).toBe(client);
    expect(attempts).toBe(2);
  });

  it("does not retry a pool that was already ended", async () => {
    const pool = {
      connect: vi.fn(async () => {
        throw new Error("Cannot use a pool after calling end on the pool");
      }),
    };

    await expect(
      acquireClientWithRetry(pool as Pick<Pool, "connect">, { sleep: async () => {} })
    ).rejects.toThrow(/after calling end/);
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });

  it("classifies lifecycle/config errors as not retryable", () => {
    expect(isRetryableConnectError(new Error(""))).toBe(true);
    expect(
      isRetryableConnectError(new Error("Cannot use a pool after calling end on the pool"))
    ).toBe(false);
    expect(
      isRetryableConnectError(
        new Error("No database URL configured (HYPERDRIVE binding or KIDDY_DATABASE_URL).")
      )
    ).toBe(false);
  });
});
