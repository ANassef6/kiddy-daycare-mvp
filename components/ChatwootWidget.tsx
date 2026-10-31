"use client";

// KID-306: Chatwoot live-chat support widget, mounted once from the root
// layout so web and the PWA/TWA packages all get it. Configuration lives in
// env (NEXT_PUBLIC_CHATWOOT_BASE_URL + NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN);
// when either is unset/empty the widget stays off entirely — nothing renders
// and no request to the Chatwoot server is made, so previews and tenants
// without Chatwoot stay clean.
//
// Bottom-right placement is Chatwoot's default; no custom positioning is
// added here on purpose.

import Script from "next/script";

declare global {
  interface Window {
    chatwootSDK?: { run: (options: { websiteToken: string; baseUrl: string }) => void };
    __kiddyChatwootRan?: boolean;
  }
}

const BASE_URL = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL?.trim() ?? "";
const WEBSITE_TOKEN = process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN?.trim() ?? "";

export default function ChatwootWidget() {
  if (!BASE_URL || !WEBSITE_TOKEN) return null;

  // Dev hot-reload can mount the root layout (and thus this component) more
  // than once; the stable script id makes Next dedupe the loader and this
  // window flag guarantees chatwootSDK.run fires exactly once per page load.
  const run = () => {
    if (typeof window === "undefined" || window.__kiddyChatwootRan) return;
    window.__kiddyChatwootRan = true;
    window.chatwootSDK?.run({ websiteToken: WEBSITE_TOKEN, baseUrl: BASE_URL });
  };

  return (
    <Script
      id="kiddy-chatwoot-widget"
      src={`${BASE_URL}/packs/js/sdk.js`}
      strategy="afterInteractive"
      onLoad={run}
    />
  );
}
