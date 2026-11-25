// KID-2476: the reveal pass is a plain function over the DOM so the re-arm
// contract can be unit-tested without a browser. components/SiteReveal.tsx
// supplies the real document/window and keys the effect on usePathname().
//
// The pass is intentionally idempotent: <html> keeps data-reveal-ready across
// client-side route changes, so every navigation must query the new page's
// [data-reveal] targets again and reveal/observe them.

export type RevealObserver = Pick<IntersectionObserver, "observe" | "unobserve" | "disconnect">;

export type CreateRevealObserver = (
  callback: IntersectionObserverCallback,
  options: IntersectionObserverInit
) => RevealObserver;

export const REVEAL_STAGGER_STEP_MS = 60;
export const REVEAL_STAGGER_MAX_MS = 240;
export const REVEAL_CLEAR_DELAY_MS = 900;

export function shouldRunRevealPass(
  win: Pick<Window, "matchMedia">,
  hasIntersectionObserver: boolean
): boolean {
  if (!hasIntersectionObserver) return false;
  return !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function applyRevealPass(
  doc: Document,
  win: Window,
  createObserver: CreateRevealObserver
): RevealObserver {
  doc.documentElement.setAttribute("data-reveal-ready", "");

  // Stagger groups: direct children become individual reveal targets with a
  // small capped cascade delay (max 240ms), cleared again once revealed so
  // later hover/press transitions on the same elements are never delayed.
  const staggerGroups = Array.from(doc.querySelectorAll<HTMLElement>("[data-reveal-stagger]"));
  for (const group of staggerGroups) {
    Array.from(group.children).forEach((child, index) => {
      const el = child as HTMLElement;
      el.setAttribute("data-reveal", "");
      el.style.transitionDelay = `${Math.min(index * REVEAL_STAGGER_STEP_MS, REVEAL_STAGGER_MAX_MS)}ms`;
    });
  }

  const targets = Array.from(doc.querySelectorAll<HTMLElement>("[data-reveal]"));
  const clearDelay = (el: HTMLElement) => {
    el.style.transitionDelay = "";
  };

  const observer = createObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.classList.add("is-revealed");
        observer.unobserve(el);
        // Reveal (450ms) + the largest stagger delay (240ms) fit well inside
        // this window; afterwards the element behaves like a plain
        // hoverable/pressable element again.
        win.setTimeout(() => clearDelay(el), REVEAL_CLEAR_DELAY_MS);
      }
    },
    { threshold: 0.1, rootMargin: "0px 0px -8% 0px" }
  );

  const inViewport = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return (
      rect.top < win.innerHeight &&
      rect.bottom > 0 &&
      rect.left < win.innerWidth &&
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

  return observer;
}
