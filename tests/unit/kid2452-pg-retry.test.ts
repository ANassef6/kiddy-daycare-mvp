// KID-2452: connect retries are for the Hyperdrive/Workers connection only.
// A retry must never re-run SQL, so these tests assert the helper retries the
// connect call and gives up with the last error.

import { describe, expect, it, vi } from "vitest";
import { connectWithRetry, describePgError } from "@/lib/pg-retry";

describe("connectWithRetry", () => {
  it("returns the first successful connection without sleeping", async () => {
    const client = { id: "client" };
    const connect = vi.fn().mockResolvedValue(client);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(connectWithRetry({ connect }, { sleep })).resolves.toBe(client);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a failed connect and returns the later success", async () => {
    const client = { id: "client" };
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error("connect failed"))
      .mockResolvedValueOnce(client);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();

    await expect(
      connectWithRetry({ connect }, { attempts: 3, baseDelayMs: 25, sleep, onFailure })
    ).resolves.toBe(client);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(25);
    expect(onFailure).toHaveBeenCalledWith(expect.any(Error), 1, true);
  });

  it("gives up after the attempt budget and throws the last error", async () => {
    const first = new Error("first");
    const last = new Error("last");
    const connect = vi
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(new Error("second"))
      .mockRejectedValueOnce(last);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();

    await expect(
      connectWithRetry({ connect }, { attempts: 3, baseDelayMs: 10, sleep, onFailure })
    ).rejects.toBe(last);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
    expect(onFailure.mock.calls.map((call) => call[2])).toEqual([true, true, false]);
  });

  it("never sleeps when attempts is 1", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("only"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(connectWithRetry({ connect }, { attempts: 1, sleep })).rejects.toThrow("only");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("describePgError", () => {
  it("keeps a non-Error value visible instead of logging an empty string", () => {
    expect(describePgError(undefined)).toEqual({ value: "undefined" });
    expect(describePgError("boom")).toEqual({ value: "boom" });
  });

  it("includes an empty message explicitly, plus name and code", () => {
    const error = Object.assign(new Error(""), { code: "ECONNRESET", errno: -104, syscall: "read" });
    expect(describePgError(error)).toMatchObject({
      name: "Error",
      message: "",
      code: "ECONNRESET",
      errno: -104,
      syscall: "read",
    });
  });
});
