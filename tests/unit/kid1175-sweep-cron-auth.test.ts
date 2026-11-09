// KID-1175/F-05: the attendance sweep endpoint must not be anonymously
// callable. The old route answered any GET/POST with the institute count,
// internal institute IDs, per-institute child/staff counts and sweep reasons
// (proven against production: POST /api/attendance/sweep returned all of
// that). Now every request must present `Authorization: Bearer $CRON_SECRET`
// (compared timing-safely over fixed-length digests, so the presented header
// can neither unlock by accident nor length-probe), or it gets a uniform
// minimal 401. An unset CRON_SECRET fails closed — the endpoint is then 401
// for everyone until the deploy env defines a secret.
//
// Pins:
//   1. unauthenticated GET/POST -> 401 with a body carrying no institute
//      identifiers, counts or reasons,
//   2. a wrong bearer secret -> the same 401 (no shape difference),
//   3. a header without the `Bearer` prefix -> 401,
//   4. CRON_SECRET unset -> 401 even when a header is presented,
//   5. the properly-authorized cron call succeeds (GET and POST) and the
//      response body is exactly `{ ok: true }` — details stay server-side.
// The sweep's own behavior (idempotent system check-outs for every
// institute, deterministic order) stays pinned by kid205.

process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedFixture } from "../helpers";

const CRON_SECRET = "kid1175-shared-cron-secret-0123456789abcdef";
const savedSecret = process.env.CRON_SECRET;

async function route(): Promise<typeof import("@/app/api/attendance/sweep/route")> {
  return await import("@/app/api/attendance/sweep/route");
}

beforeEach(async () => {
  await seedFixture();
  process.env.CRON_SECRET = CRON_SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

describe("KID-1175/F-05 sweep endpoint authentication", () => {
  it("a request with no authorization header gets a uniform minimal 401 (GET and POST)", async () => {
    const { GET, POST } = await route();
    for (const handler of [GET, POST]) {
      const res = await handler(new Request("http://localhost/api/attendance/sweep"));
      expect(res.status).toBe(401);
      // Exactly { ok: false }: no institute identifiers, counts or reasons.
      expect(await res.json()).toEqual({ ok: false });
    }
  });

  it("a wrong bearer secret gets the exact same 401 (no shape difference to probe)", async () => {
    const { GET } = await route();
    const res = await GET(
      new Request("http://localhost/api/attendance/sweep", {
        headers: { authorization: `Bearer wrong-secret-entirely-0123456789` },
      })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("a raw-secret header without the Bearer prefix is refused", async () => {
    const { GET } = await route();
    const res = await GET(
      new Request("http://localhost/api/attendance/sweep", {
        headers: { authorization: CRON_SECRET },
      })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("CRON_SECRET unset fails closed: even a well-formed header is rejected", async () => {
    delete process.env.CRON_SECRET;
    const { GET, POST } = await route();
    for (const handler of [GET, POST]) {
      const res = await handler(
        new Request("http://localhost/api/attendance/sweep", {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        })
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false });
    }
  });

  it("the authorized cron call succeeds on GET and POST with a body of exactly { ok: true }", async () => {
    const { GET, POST } = await route();
    const call = (method: string) =>
      new Request("http://localhost/api/attendance/sweep", {
        method,
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
    for (const handler of [GET, POST]) {
      const res = await handler(call(handler === GET ? "GET" : "POST"));
      expect(res.status).toBe(200);
      // Minimal response: no institute ids/counts/reasons anywhere in it.
      expect(await res.json()).toEqual({ ok: true });
    }
  });
});
