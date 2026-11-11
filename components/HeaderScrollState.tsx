"use client";

// KID-1826 deliverable 2: the sticky marketing header reacts to scroll with a
// subtle state change (background opacity, hairline color, soft shadow). The
// attribute is toggled on the closest <header> — no re-render, no layout
// shift, only paint properties inside a CSS transition. The rAF throttle
// keeps the scroll handler cheap; the attribute is also corrected once on
// mount so a mid-page load renders the right state immediately.
import { useEffect, useRef } from "react";

export default function HeaderScrollState() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = ref.current?.closest("header");
    if (!header) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      header.toggleAttribute("data-scrolled", window.scrollY > 8);
    };
    update();
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <span ref={ref} hidden aria-hidden="true" />;
}
