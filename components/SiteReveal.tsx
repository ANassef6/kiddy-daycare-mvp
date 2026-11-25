"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { applyRevealPass, shouldRunRevealPass } from "@/lib/marketing-reveal";

// KID-2077: scroll-reveal driver for the five public marketing pages. A tiny
// client component (no dependency, no animation library) that:
//   1. arms the CSS hidden state by setting data-reveal-ready on <html> —
//      server HTML always renders fully visible, so no-JS visitors, crawlers
//      and reduced-motion users never see a blank section;
//   2. marks every element already inside the viewport as revealed inline
//      (same style recalc as arming → no flash of hidden content, no CLS);
//   3. observes the rest with an IntersectionObserver and reveals each one
//      once — the observer unobserves after reveal, so scrolling back up
//      never re-triggers.
// The hero is not tagged with data-reveal (it already has its KID-1826
// load-time animation), so it is never re-animated. prefers-reduced-motion
// users return early: the armed state is never set and everything stays
// visible with zero motion. Reveals move vertically only, so RTL/AR is
// unaffected and no horizontal overflow can be introduced.
//
// KID-2458/KID-2476: <html> is document-global and stays armed across
// client-side route changes. Each page mounts its own <SiteReveal />, so the
// effect must run per pathname — arming is idempotent and the new page's
// targets are revealed or observed on every navigation. The reveal work lives
// in lib/marketing-reveal.ts so the re-arm contract is unit-tested.
export default function SiteReveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (!shouldRunRevealPass(window, typeof IntersectionObserver !== "undefined")) return;

    const observer = applyRevealPass(
      document,
      window,
      (callback, options) => new IntersectionObserver(callback, options)
    );

    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
