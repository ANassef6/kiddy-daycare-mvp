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
//
// Signed-in visitors are identified with `$chatwoot.setUser` using the
// server-computed identity from /api/chatwoot/identity. That attaches the live
// conversation to the same Chatwoot contact the server pre-creates at account
// creation, so support sees the Kiddy name/email/role/daycare/children.

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";

export type ChatwootIdentity = {
  identifier: string;
  name: string;
  email: string;
  phone_number?: string;
  company_name?: string;
  description?: string;
  identifier_hash?: string;
  custom_attributes: Record<string, string>;
};

type ChatwootUser = {
  name: string;
  email: string;
  phone_number?: string;
  company_name?: string;
  description?: string;
  identifier_hash?: string;
  custom_attributes: Record<string, string>;
};

type ChatwootApi = {
  setUser: (identifier: string, user: ChatwootUser) => void;
  reset?: () => void;
};

declare global {
  interface Window {
    chatwootSDK?: { run: (options: { websiteToken: string; baseUrl: string }) => void };
    $chatwoot?: ChatwootApi;
    __kiddyChatwootRan?: boolean;
    __kiddyChatwootIdentified?: string | null;
  }
}

const BASE_URL = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL?.trim() ?? "";
const WEBSITE_TOKEN = process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN?.trim() ?? "";

export function buildChatwootUser(identity: ChatwootIdentity): ChatwootUser {
  return {
    name: identity.name,
    email: identity.email,
    ...(identity.phone_number ? { phone_number: identity.phone_number } : {}),
    ...(identity.company_name ? { company_name: identity.company_name } : {}),
    ...(identity.description ? { description: identity.description } : {}),
    ...(identity.identifier_hash ? { identifier_hash: identity.identifier_hash } : {}),
    custom_attributes: identity.custom_attributes,
  };
}

/** Apply (or clear) the Chatwoot identity on the live widget. Exported for tests. */
export function applyChatwootIdentity(
  chatwoot: ChatwootApi,
  identity: ChatwootIdentity | null,
): void {
  if (!identity) {
    if (window.__kiddyChatwootIdentified) {
      chatwoot.reset?.();
      window.__kiddyChatwootIdentified = null;
    }
    return;
  }
  if (window.__kiddyChatwootIdentified === identity.identifier) return;
  chatwoot.setUser(identity.identifier, buildChatwootUser(identity));
  window.__kiddyChatwootIdentified = identity.identifier;
}

/** Run the Chatwoot SDK once per page load. Exported for tests. */
export function runChatwootSdk(
  win: Window | undefined,
  options: { websiteToken: string; baseUrl: string },
): void {
  if (!win || win.__kiddyChatwootRan) return;
  win.__kiddyChatwootRan = true;
  win.chatwootSDK?.run(options);
}

/** The load-once script element, separated so tests can inspect its props. */
export function ChatwootScript({ onLoad }: { onLoad: () => void }) {
  return (
    <Script
      id="kiddy-chatwoot-widget"
      src={`${BASE_URL}/packs/js/sdk.js`}
      strategy="afterInteractive"
      onLoad={onLoad}
    />
  );
}

export default function ChatwootWidget() {
  const pathname = usePathname();
  const identityRef = useRef<ChatwootIdentity | null>(null);

  const applyIdentity = useCallback(() => {
    if (typeof window === "undefined") return;
    const chatwoot = window.$chatwoot;
    if (!chatwoot) return;
    applyChatwootIdentity(chatwoot, identityRef.current);
  }, []);

  // Re-resolve the identity on every navigation so login, logout and profile
  // changes apply without a hard reload (the SDK itself only runs once).
  useEffect(() => {
    if (!BASE_URL || !WEBSITE_TOKEN) return;
    let cancelled = false;
    const loadIdentity = async () => {
      try {
        const response = await fetch("/api/chatwoot/identity", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { identity?: ChatwootIdentity | null };
        if (cancelled) return;
        identityRef.current = data.identity ?? null;
        applyIdentity();
      } catch {
        // Best effort: the widget still works anonymously.
      }
    };
    void loadIdentity();
    return () => {
      cancelled = true;
    };
  }, [pathname, applyIdentity]);

  if (!BASE_URL || !WEBSITE_TOKEN) return null;

  // Dev hot-reload can mount the root layout (and thus this component) more
  // than once; the stable script id makes Next dedupe the loader and this
  // window flag guarantees chatwootSDK.run fires exactly once per page load.
  const run = () => {
    if (typeof window === "undefined") return;
    runChatwootSdk(window, { websiteToken: WEBSITE_TOKEN, baseUrl: BASE_URL });
    // The identity fetch may have finished before the SDK loaded.
    applyIdentity();
  };

  return <ChatwootScript onLoad={run} />;
}
