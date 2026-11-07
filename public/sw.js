/*
 * KID-480: Kiddy service worker — web push for the PWA/TWA parent surface.
 *
 * Kept dependency-free and failure-tolerant on purpose: a malformed payload,
 * a missing key or an unsupported browser must never break the page (the tab
 * still works without the worker; only background pushes degrade).
 *
 * Registration: components/ServiceWorkerRegister mounts on both authenticated
 * shells — the parent surface (app/child) and the staff portal
 * (app/portal, KID-487) — and registers this file with scope "/" when the
 * browser supports it. Staff and parent notifications share one worker.
 */
const ICON = "/brand-icon.svg";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    console.error("KID-480 push payload parse failed:", err);
  }
  const title = data.title || "Kiddy";
  const options = {
    body: data.body || "",
    icon: data.icon || ICON,
    // bad/sound: Android plays the default notification sound automatically;
    // the icon/badge reuse the existing tenant brand asset.
    // KID-487: silent:false keeps the audible default where the platform
    // honors it (Chromium); iOS/Home-Screen web push uses the system sound.
    silent: false,
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        try {
          if (new URL(client.url).pathname === url || client.url.endsWith(url)) {
            if ("focus" in client) return client.focus();
          }
        } catch (err) {
          console.error("KID-480 notificationclick match failed:", err);
        }
      }
      for (const client of all) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          try {
            await client.navigate(url);
            return client.focus();
          } catch (err) {
            console.error("KID-480 notificationclick navigate failed:", err);
          }
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
