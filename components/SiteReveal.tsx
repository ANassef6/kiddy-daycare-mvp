"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

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
// KID-2458: <html> is document-global and stays armed across client-side
// route changes. Each page mounts its own <SiteReveal />, but the old
// `hasAttribute` guard made the new instance return early, so the new page's
// server-rendered [data-reveal] sections stayed at opacity 0 — the blank hero
// band seen when clicking from the landing page to any other marketing page.
// The effect now runs per pathname: arming is idempotent and the new page's
// targets are revealed or observed on every navigation.
export default function SiteReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    root.setAttribute("data-reveal-ready", "");

    // Stagger groups: direct children become individual reveal targets with a
    // small capped cascade delay (max 240ms), cleared again once revealed so
    // later hover/press transitions on the same elements are never delayed.
    const staggerGroups = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal-stagger]")
    );
    for (const group of staggerGroups) {
      Array.from(group.children).forEach((child, index) => {
        const el = child as HTMLElement;
        el.setAttribute("data-reveal", "");
        el.style.transitionDelay = `${Math.min(index * 60, 240)}ms`;
      });
    }

    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const clearDelay = (el: HTMLElement) => {
      el.style.transitionDelay = "";
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.classList.add("is-revealed");
          observer.unobserve(el);
          // Reveal (450ms) + the largest stagger delay (240ms) fit well
          // inside this window; afterwards the element behaves like a plain
          // hoverable/pressable element again.
          window.setTimeout(() => clearDelay(el), 900);
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -8% 0px" }
    );

    const inViewport = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return (
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0
      );
    };

    for (const el of targets) {
      if (inViewport(el)) {
        // Reveal synchronously in the same style recalc that arms the hidden
        // state — nothing hidden is ever painted, so there is no flash.
        el.classList.add("is-revealed");
        clearDelay(el);
      } else {
        observer.observe(el);
      }
    }

    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
