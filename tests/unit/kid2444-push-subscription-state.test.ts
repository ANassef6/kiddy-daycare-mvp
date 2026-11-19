// KID-2444: the parent settings push card used to treat
// Notification.permission === "granted" as "subscribed". Chrome can keep the
// permission while the actual push subscription is gone (browser data cleared,
// browser update, unsubscribed elsewhere), so the card showed "enabled" with
// no Enable button and no notification could arrive.
//
// The card must derive its enabled state from the real PushManager
// subscription, and fall back to the Enable action when it is missing.
//
// This is a source pin (the component's subscription check needs a browser
// runtime; the behaviour is verified end-to-end on staging with Playwright and
// on the Android v5 TWA).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";


const src = fs.readFileSync(
  path.join(process.cwd(), "components/PushNotificationsCard.tsx"),
  "utf8",
);

describe("KID-2444: push card enabled state follows the real subscription", () => {
  it("uses the PushManager subscription, not the permission alone, to decide 'subscribed'", () => {
    expect(src).toContain("const existing = await reg?.pushManager.getSubscription();");
    expect(src).toContain('setState(existing ? "subscribed" : "default");');
    // regression: the old permission-only branch must not come back
    expect(src).not.toContain('Notification.permission === "granted" ? "subscribed" : "default"');
  });

  it("keeps the grant-denied and missing-VAPID degradations", () => {
    expect(src).toContain('if (permission === "denied")');
    expect(src).toContain('setState("not-configured")');
    expect(src).toContain("if (!keyData.publicKey)");
  });
});
