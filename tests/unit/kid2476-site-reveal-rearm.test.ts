// KID-2476: the public marketing pages went blank again after client-side
// navigation because <html> stayed armed with data-reveal-ready while the
// re-mounted SiteReveal effect returned early. These tests pin the re-arm
// contract:
//   1. every pass (one per pathname) queries the current page's targets and
//      reveals or observes them — the second pass must do real work;
//   2. in-viewport targets are revealed synchronously, below-fold ones are
//      observed, stagger children get capped delays, and the delay is cleared
//      after the reveal window;
//   3. reduced motion / no IntersectionObserver never arm the hidden state;
//   4. source guards: SiteReveal is keyed on usePathname (no early return) and
//      the four section-head heroes stay out of [data-reveal], so they render
//      visible in the server HTML and never depend on client JS.
//
// The suite runs in a node environment (no DOM), so the pass runs against a
// minimal fake document/window/observer, and the renderer-invisible contract
// is pinned with source guards (same pattern as KID-367).

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  REVEAL_CLEAR_DELAY_MS,
  applyRevealPass,
  shouldRunRevealPass,
  type CreateRevealObserver,
} from "@/lib/marketing-reveal";

type Rect = { top: number; bottom: number; left: number; right: number };

type FakeElement = {
  attrs: Set<string>;
  classes: Set<string>;
  style: { transitionDelay: string };
  children: FakeElement[];
  getBoundingClientRect(): Rect;
  setAttribute(name: string, value?: string): void;
  classList: { add(token: string): void };
};

function makeElement(rect: Partial<Rect> = {}, children: FakeElement[] = []): FakeElement {
  let el: FakeElement;
  el = {
    attrs: new Set<string>(),
    classes: new Set<string>(),
    style: { transitionDelay: "" },
    children,
    getBoundingClientRect: () => ({
      top: rect.top ?? 0,
      bottom: rect.bottom ?? 100,
      left: rect.left ?? 0,
      right: rect.right ?? 100,
    }),
    setAttribute: (name: string) => {
      el.attrs.add(name);
    },
    classList: {
      add: (token: string) => {
        el.classes.add(token);
      },
    },
  };
  return el;
}

function makePage() {
  const rootAttrs = new Set<string>();
  const root = {
    attrs: rootAttrs,
    setAttribute: (name: string) => {
      rootAttrs.add(name);
    },
    hasAttribute: (name: string) => rootAttrs.has(name),
  };
  const state = { elements: [] as FakeElement[], groups: [] as FakeElement[] };
  const doc = {
    documentElement: root,
    querySelectorAll: (selector: string) => {
      if (selector === "[data-reveal-stagger]") return state.groups;
      if (selector === "[data-reveal]") {
        return state.elements.filter((el) => el.attrs.has("data-reveal"));
      }
      return [];
    },
  } as unknown as Document;
  return { root, state, doc };
}

function makeWindow(opts: { reducedMotion?: boolean } = {}) {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const win = {
    innerHeight: 900,
    innerWidth: 1366,
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    matchMedia: (query: string) => ({
      matches: query.includes("prefers-reduced-motion: reduce") ? Boolean(opts.reducedMotion) : false,
    }),
  } as unknown as Window;
  return {
    win,
    timers,
    runTimers: () => {
      for (const timer of timers.splice(0)) timer.fn();
    },
  };
}

function makeObserverHarness() {
  const observed = new Set<FakeElement>();
  let callback: IntersectionObserverCallback | null = null;
  let options: IntersectionObserverInit | undefined;

  const create = ((cb: IntersectionObserverCallback, init?: IntersectionObserverInit) => {
    callback = cb;
    options = init;
    return {
      observe: (target: Element) => {
        observed.add(target as unknown as FakeElement);
      },
      unobserve: (target: Element) => {
        observed.delete(target as unknown as FakeElement);
      },
      disconnect: () => {
        observed.clear();
      },
    };
  }) as CreateRevealObserver;

  return {
    create,
    observed,
    options: () => options,
    dispatch: (entries: Array<{ target: FakeElement; isIntersecting: boolean }>) => {
      if (!callback) throw new Error("observer was not created");
      callback(
        entries as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver
      );
    },
    reveal: (targets: FakeElement[]) => {
      if (!callback) throw new Error("observer was not created");
      callback(
        targets.map((target) => ({ isIntersecting: true, target })) as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver
      );
    },
  };
}

const ROOT = process.cwd();
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("KID-2476: applyRevealPass re-arms on every navigation", () => {
  it("processes the new page's targets on a second pass (no early return)", () => {
    const page = makePage();
    const inView = makeElement({ top: 10, bottom: 200 });
    const belowFold = makeElement({ top: 1200, bottom: 1400 });
    inView.attrs.add("data-reveal");
    belowFold.attrs.add("data-reveal");
    const group = makeElement({ top: 500, bottom: 2000 });
    const childA = makeElement({ top: 1200, bottom: 1300 });
    const childB = makeElement({ top: 1320, bottom: 1420 });
    group.children = [childA, childB];
    page.state.groups = [group];
    page.state.elements = [inView, belowFold, childA, childB];

    const { win } = makeWindow();
    const first = makeObserverHarness();
    applyRevealPass(page.doc, win, first.create);

    expect(page.root.hasAttribute("data-reveal-ready")).toBe(true);
    expect(inView.classes.has("is-revealed")).toBe(true);
    expect(first.observed.has(belowFold)).toBe(true);
    expect(first.observed.has(childA)).toBe(true);
    expect(first.observed.has(childB)).toBe(true);
    expect(childA.attrs.has("data-reveal")).toBe(true);
    expect(childA.style.transitionDelay).toBe("0ms");
    expect(childB.style.transitionDelay).toBe("60ms");
    expect(first.options()).toMatchObject({ threshold: 0.1, rootMargin: "0px 0px -8% 0px" });

    // Client-side navigation replaces the page tree but <html> stays armed.
    const nextInView = makeElement({ top: 10, bottom: 200 });
    nextInView.attrs.add("data-reveal");
    page.state.groups = [];
    page.state.elements = [nextInView];

    const second = makeObserverHarness();
    applyRevealPass(page.doc, win, second.create);

    expect(nextInView.classes.has("is-revealed")).toBe(true);
    expect(second.observed.size).toBe(0);
  });

  it("reveals an observed target once, stops observing, and clears the delay", () => {
    const page = makePage();
    const belowFold = makeElement({ top: 1200, bottom: 1400 });
    belowFold.attrs.add("data-reveal");
    belowFold.style.transitionDelay = "180ms";
    page.state.elements = [belowFold];

    const { win, timers, runTimers } = makeWindow();
    const harness = makeObserverHarness();
    applyRevealPass(page.doc, win, harness.create);

    expect(harness.observed.has(belowFold)).toBe(true);
    harness.reveal([belowFold]);

    expect(belowFold.classes.has("is-revealed")).toBe(true);
    expect(harness.observed.has(belowFold)).toBe(false);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(REVEAL_CLEAR_DELAY_MS);
    expect(belowFold.style.transitionDelay).toBe("180ms");

    runTimers();
    expect(belowFold.style.transitionDelay).toBe("");
  });

  it("ignores non-intersecting observer entries", () => {
    const page = makePage();
    const belowFold = makeElement({ top: 1200, bottom: 1400 });
    belowFold.attrs.add("data-reveal");
    page.state.elements = [belowFold];

    const { win } = makeWindow();
    const harness = makeObserverHarness();
    applyRevealPass(page.doc, win, harness.create);
    harness.dispatch([{ target: belowFold, isIntersecting: false }]);

    expect(belowFold.classes.has("is-revealed")).toBe(false);
    expect(harness.observed.has(belowFold)).toBe(true);
  });
});

describe("KID-2476: reduced motion and missing observer never arm the reveal", () => {
  it("runs the pass only with an observer and no reduced-motion preference", () => {
    expect(shouldRunRevealPass(makeWindow().win, true)).toBe(true);
    expect(shouldRunRevealPass(makeWindow({ reducedMotion: true }).win, true)).toBe(false);
    expect(shouldRunRevealPass(makeWindow().win, false)).toBe(false);
  });
});

describe("KID-2476: source guards for SiteReveal and the section-head heroes", () => {
  const siteReveal = stripComments(
    fs.readFileSync(path.join(ROOT, "components", "SiteReveal.tsx"), "utf8")
  );

  it("keys the reveal effect on usePathname and has no armed-state early return", () => {
    expect(siteReveal).toMatch(/usePathname\(\)/);
    expect(siteReveal).toMatch(/\[pathname\]/);
    expect(siteReveal).not.toMatch(/hasAttribute\(\s*["']data-reveal-ready["']\s*\)/);
    expect(siteReveal).toContain("applyRevealPass");
  });

  it("keeps every section-head hero out of [data-reveal]", () => {
    const pages = ["page.tsx", "features/page.tsx", "for-parents/page.tsx", "for-centers/page.tsx", "contact/page.tsx"];
    for (const page of pages) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, "app", page), "utf8"));
      expect(src).toContain("<SiteReveal />");
      expect(src).not.toMatch(
        /section-head[\s\S]{0,400}?<div className="container"[^>]*data-reveal/
      );
    }
    // Below-the-fold reveal sections must remain on the four inner pages.
    for (const page of ["features/page.tsx", "for-parents/page.tsx", "for-centers/page.tsx", "contact/page.tsx"]) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, "app", page), "utf8"));
      expect(src).toContain("data-reveal-stagger");
    }
  });
});
