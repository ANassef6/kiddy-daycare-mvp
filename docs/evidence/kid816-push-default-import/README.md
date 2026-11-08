# KID-816 — Production push send was crashing on the web-push default import

KID-687 QA defect D1: in a production build (`next build` + `next start`) every
push send threw `TypeError: Cannot read properties of undefined` and the
invoice-created push from KID-684 reached no device.

## Root cause

`lib/push.ts` resolved the sender as `(await import("web-push")).default`.
`web-push@4.0.0` is a pure-ESM package whose module exposes **named exports
only** (`export function sendNotification`, `src/index.js`) — there is no
`default` export. So in the Next server bundle `mod.default` was
`undefined` and `webpush.sendNotification(...)` threw
`TypeError: Cannot read properties of undefined (reading 'sendNotification')`
on every send. Unit tests hid it because their mocks returned
`{ default: { sendNotification } }` — an export shape the real module does not
have.

## The fix (exact before/after)

`lib/push.ts` `defaultSender`:

```diff
-  const webpush = (await import("web-push")).default;
-  await webpush.sendNotification(
+  const { sendNotification } = await import("web-push");
+  await sendNotification(
```

`@types/web-push` types the namespace with named exports, so the destructure is
type-checked against the real shape. No mock interop, no guessed fallback: both
the Next server bundle (native `import("web-push")` of the ESM namespace) and
vitest mocks (which now expose the same shape) resolve the same named export.

## Test mock alignment (the mock now mirrors reality)

`tests/unit/kid472-push-sound.test.ts` and
`tests/unit/kid684-invoice-created-notification.test.ts` previously mocked:

```diff
-vi.mock("web-push", () => ({ default: { sendNotification } }));
+vi.mock("web-push", () => ({ sendNotification }));
```

With the aligned mock, every existing KID-480/KID-684 push assertion double as
aft-regression coverage. A dedicated regression test pins the sender resolution
explicitly:

`tests/unit/kid472-push-sound.test.ts` — *KID-816 regression: the production
defaultSender reaches sendNotification through the real web-push module shape
(named exports, no default)* — drives `sendPushToAccounts` with NO injected
sender (the production `defaultSender` exactly as Next serves it) and asserts
one `sendNotification` call, the payload tag, VAPID details and
`delivered === 1`.

**Fails on the unfixed code, passes on the fix (verified by hand):** with
`lib/push.ts` reverted to `.default`, this test fails with 0 calls and the log:

```
KID-480 push send failed (endpoint ends ...com/fcm/send/ea1, ref=kid816-regression):
Error: [vitest] No "default" export is defined on the "web-push" mock.
```

(vitest's ESM mock namespace even names the problem — the same module shape real
Next production exhibits.) With the fix, that test and the full battery pass.

## Gate battery on this tree

- `npm test` — **91 files / 1006 tests, all green** (kid472 24/24, kid684 10/10).
- `npx tsc --noEmit` — clean; `next lint` — clean (single pre-existing
  `<img>` warning, KID-489 heritage); `next build` — green;
  `node supabase/verify-migrations.mjs` — all migration checks passed.

## Production-build send check (`next build` + `next start`, KID-684 path)

Fresh SQLite db (`file:`), demo seed, a real generated VAPID keypair
(`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, via env only), one real-format
`push_subscription` row for the linked parent (`Grace Nguyen`, `role='parent'`,
linked to child Ella Nguyen), endpoint `https://fcm.googleapis.com/fcm/send/invalid-kid816-token`
(real push service). The admin signed in (server-action session cookie) and
created a child invoice **through the real `createChildBillingAction` server
action of the production build** (the browser form's own progressive-enhancement
`$ACTION_ID_…` wire format, served by `next start`):

1. `child_billing` row written; exactly one `invoice_created` notification row
   emitted for the linked parent — `ref=invoice-created-mw7e9gji-sgk9ock6`,
   payload `childId/childName ("Ella Nguyen")/description/amount ("1200.00
   EGP")/dueDate` (same payload + deep-link pipeline pinned by the kid684
   tests).
2. The fan-out ran the production `defaultSender` through the **bundled**
   web-push (`stack inside .next/server/chunks/4789.js`), made the REAL HTTPS
   push attempt, and FCM answered **410** (stale/unknown token, a push-service
   error): no `TypeError`, and the sender then exercised the designed
   lazy-prune (the dead row was deleted). grep of the whole server log: **zero**
   `TypeError` / `Cannot read properties` lines.
3. Direct-observation leg: with a second subscription row whose push service
   answers **406** (non-stale, kept by design), a second invoice created through
   the same production build produced the send-attempt log line verbatim:

```
KID-480 push send failed (endpoint ends .../push/not_kid816, ref=invoice-created-mw7eapgp-2pwmafx6): M [WebPushError]: Received unexpected response code
    at IncomingMessage.<anonymous> (.../kiddy-daycare-mvp/.next/server/chunks/4789.js:7:8791)
  statusCode: 406, endpoint: 'https://updates.push.services.mozilla.com/push/not_kid816'
```

That log line is the production-build proof that the sender resolves the real
module, reaches `sendNotification`, gets a push-service response (here 406;
404/410 legs prune) and **never throws the default-import TypeError**. The
second invoice also got a fresh distinct ref — no dedupe regression.

## Honesty notes

- Real device delivery remains out of scope (needs a genuine subscribed
  browser; unchanged from the plan). The 406/410 answers above are push-service
  rejections of a probe endpoint — content bytes are not echoed by push
  services, so wire-level `url: /child/<childId>#invoices` equality is proven by
  the unit battery (kid472/kid684 assert the exact JSON payload + deep link for
  the invoice_created kind); the prod logs prove the send attempt and error
  classification.
- The QA environment lacks the system libraries for a local headless browser,
  so the invoice leg was driven through the production server's own
  server-action HTTP surface (the exact wire format Chrome posts: multipart
  form with the `$ACTION_ID_…` field), and the login was captured by replaying
  React's `encodeReply` flight encoding. No production code changed for the
  harness; the served UI itself was smoke-checked (`next start` returning 200
  on /login and on the authenticated /portal billing page with the session
  cookie).
