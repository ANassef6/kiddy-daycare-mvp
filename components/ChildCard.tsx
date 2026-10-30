"use client";

// KID-367 / DEF-006: the child cards in app/child/page.tsx used a default
// <Link>, so every render of /child started a viewport prefetch of
// /child/[id] (an RSC shell request). On Android/cellular that request can
// sit in flight for seconds (7.4s stalled during the KID-257 live audit). A
// tap inside that window joins the in-flight prefetch instead of starting a
// fresh navigation, so the detail route's loading boundary (KID-254) never
// engages and the tap stays completely silent — no URL change, no skeleton —
// for the whole remaining in-flight window.
//
// prefetch={false} closes that window: the card never prefetches so every tap
// starts a fresh navigation that commits the URL and renders the aria-busy
// skeleton immediately while the child's data streams in. The detail route is
// dynamic, so the dropped prefetch only ever warmed the loading shell —
// nothing about the warm path that KID-254 measured (~265 ms URL + skeleton
// after tap) changes.

import Link from "next/link";
import type { ReactNode } from "react";

export default function ChildCard({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} prefetch={false} className="card" style={{ color: "var(--color-text)" }}>
      {children}
    </Link>
  );
}
