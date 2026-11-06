"use client";

import { useEffect } from "react";

// KID-480: registers public/sw.js on the parent shell once the page is idle.
// Unsupported browsers (and Safari on iOS before 16.4) simply never register —
// a silent degradation, never a console noise or broken UI.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const t = window.setTimeout(() => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.error("KID-480 service worker registration failed:", err));
    }, 1500);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
