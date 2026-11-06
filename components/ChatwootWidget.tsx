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

export type ChatwootApi = {
  setUser: (identifier: string, user: ChatwootUser) => void;
  reset?: () => void;
  // KID-475: the SDK's bubble-only visibility switch (launcher hidden, chat
  // itself still programmatically available). Optional because it was added to
  // the SDK after this integration shipped.
  toggleBubbleVisibility?: (visibility: "hide" | "show") => void;
};

declare global {
  interface Window {
    chatwootSDK?: { run: (options: { websiteToken: string; baseUrl: string }) => void };
    $chatwoot?: ChatwootApi;
    __kiddyChatwootRan?: boolean;
    __kiddyChatwootIdentified?: string | null;
    __kiddyChatwootBubbleHidden?: boolean;
  }
}

const BASE_URL = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL?.trim() ?? "";
const WEBSITE_TOKEN = process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN?.trim() ?? "";

// KID-475: the launcher bubble is a fixed bottom-right 48px overlay that floats
// over every scroll position. On the messaging surfaces it sits exactly where
// the composer's interactive area lands once the parent scrolls the form into
// the lower part of the screen (and, at short viewports such as 320x568, it
// statically covers the message input's corner — elementFromPoint returned the
// bubble for taps inside the input). It is hidden on the two chat routes and
// restored everywhere else; support stays reachable from any other page and
// from the parent support page itself.
export const CHATWOOT_BUBBLE_HIDDEN_ROUTES = ["/child/messages", "/portal/messages"];

export function chatwootBubbleShouldHide(pathname: string | undefined): boolean {
  if (!pathname) return false;
  return CHATWOOT_BUBBLE_HIDDEN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
}

/**
 * One attempt to apply (or restore) the launcher-bubble visibility for the
 * current route. Exported for tests. Returns true when the applied state
 * matches the route (including when nothing had to change); false when the SDK
 * was not present or its DOM was not ready yet.
 *
 * The SDK builds the holder/bubble DOM asynchronously after chatwootSDK.run
 * returns, so its toggle can crash on a missing element during that window —
 * retry the scheduleChatwootBubbleVisibility loop instead of trusting one call.
 */
export function applyChatwootBubbleVisibility(chatwoot: ChatwootApi | undefined, pathname: string): boolean {
  const toggle = chatwoot?.toggleBubbleVisibility;
  if (!toggle) return false;
  const shouldHide = chatwootBubbleShouldHide(pathname);
  if (window.__kiddyChatwootBubbleHidden === shouldHide) return true;
  try {
    toggle(shouldHide ? "hide" : "show");
    window.__kiddyChatwootBubbleHidden = shouldHide;
    return true;
  } catch {
    // SDK DOM element (widget holder or bubble holder) not in the document
    // yet — the scheduled retry applies the state once it exists.
    return false;
  }
}

const BUBBLE_RETRY_DELAYS_MS = [0, 250, 600, 1200, 2500];

/**
 * Client-side scheduler loop: keeps one-attempting the route-based bubble
 * visibility until it holds (or the retry budget ends). Cancels a loop from a
 * previous navigation, so rapid route changes settle on the newest one.
 */
export function scheduleChatwootBubbleVisibility(pathname: string, win: Window = window): void {
  if (typeof win === "undefined") return;
  const id = ++bubbleScheduleCounter;
  const attemptAt = (ms: number) => {
    if (id !== bubbleScheduleCounter) return;
    const runOne = () => {
      if (id !== bubbleScheduleCounter) return;
      if (applyChatwootBubbleVisibility(win.$chatwoot, pathname)) return;
      const next = BUBBLE_RETRY_DELAYS_MS[BUBBLE_RETRY_DELAYS_MS.indexOf(ms) + 1];
      if (next !== undefined) attemptAt(next);
    };
    if (ms === 0) runOne();
    else win.setTimeout(runOne, ms);
  };
  attemptAt(0);
}

let bubbleScheduleCounter = 0;

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
  // KID-475: the same navigation points also (re-)apply the launcher-bubble
  // visibility for the current route.
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
    scheduleChatwootBubbleVisibility(pathname);
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
    // ...and the initial route may already be a messaging surface, so start
    // the schedule right after the SDK is live (its DOM is still building).
    scheduleChatwootBubbleVisibility(pathname);
  };

  return <ChatwootScript onLoad={run} />;
}
