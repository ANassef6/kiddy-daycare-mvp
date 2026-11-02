// KID-453: the portal shell grid must resolve to the same tracks in LTR and RTL.
//
// `.shell` is a two-track grid — `aside.shell-side` is the first child,
// `main.shell-main` the second — declared as
// `.shell { grid-template-columns: 220px 1fr }`. Under `dir="rtl"` CSS Grid
// places track 1 on the RIGHT, so that base rule already puts the 220px
// sidebar on the right and `main` in the 1fr track; no RTL override is needed.
//
// The KID-57 override `html[dir="rtl"] .shell { grid-template-columns: 1fr 220px }`
// reversed the tracks on every Arabic portal page (sidebar 860px, main 220px,
// 64px of horizontal overflow at 1080px) and, out-specifying the
// `@media (max-width: 720px) { .shell { grid-template-columns: 1fr } }` rule,
// kept a sidebar track in RTL at phone widths too.
//
// This suite has no DOM, so instead of a browser the assertions resolve the
// cascade the browser would apply to `<div class="shell">` — media queries,
// specificity and source order — out of app/globals.css for both directions at
// a desktop width (1080) and a phone width (700). Geometry (bounding boxes,
// scrollWidth) is asserted in the browser pass recorded in
// docs/evidence/kid453/.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Dir = "ltr" | "rtl";

interface Viewport {
  dir: Dir;
  width: number;
}

interface CascadeRule {
  selector: string;
  media: string | null;
  declarations: Record<string, string>;
  order: number;
}

interface ResolvedDeclaration {
  value: string;
  selector: string;
  media: string | null;
}

const CSS = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

const DESKTOP: Viewport = { dir: "rtl", width: 1080 };
const PHONE: Viewport = { dir: "rtl", width: 720 };

/** Strip comments so commented-out rules never enter the cascade. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Split a declaration block body into `property -> value`. */
function parseDeclarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of body.split(";")) {
    const colon = chunk.indexOf(":");
    if (colon === -1) continue;
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim().replace(/\s+/g, " ");
    if (prop) out[prop] = value;
  }
  return out;
}

/**
 * Parse top-level rules and nested @media blocks into a flat list, keeping a
 * global source order so cascade order matches the stylesheet.
 */
function parseRules(css: string, media: string | null = null, order = { n: 0 }): CascadeRule[] {
  const out: CascadeRule[] = [];
  const source = stripComments(css);
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("{", i);
    if (open === -1) break;
    const prelude = source.slice(i, open).trim().replace(/\s+/g, " ");
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === "{") depth += 1;
      else if (source[j] === "}") depth -= 1;
      j += 1;
    }
    const body = source.slice(open + 1, j - 1);
    if (prelude.startsWith("@media")) {
      out.push(...parseRules(body, prelude.slice("@media".length).trim(), order));
    } else if (prelude.startsWith("@")) {
      // @font-face / @keyframes / @supports — no `.shell` grid rules live here.
    } else {
      for (const selector of prelude.split(",").map((s) => s.trim()).filter(Boolean)) {
        out.push({
          selector,
          media,
          declarations: parseDeclarations(body),
          order: order.n++,
        });
      }
    }
    i = j;
  }
  return out;
}

interface Element {
  tag: string;
  classes: string[];
  attrs: Record<string, string>;
}

/** The element under test: `<div class="shell">` inside `<body>` inside `<html>`. */
const SUBJECT: Element = { tag: "div", classes: ["shell"], attrs: {} };

function ancestorsFor(viewport: Viewport): Element[] {
  return [
    { tag: "body", classes: [], attrs: {} },
    { tag: "html", classes: [], attrs: { dir: viewport.dir } },
  ];
}

/** Parse one compound selector (`html[dir="rtl"]`, `.shell`, `div.shell`) into matchers. */
function parseCompound(compound: string): {
  tag: string | null;
  classes: string[];
  ids: string[];
  attrs: Array<{ name: string; value: string | null }>;
  unsupported: string;
} {
  const tag = /^(?:[a-zA-Z][\w-]*)/.exec(compound)?.[0] ?? null;
  const classes = [...compound.matchAll(/\.(-?[_a-zA-Z]+[\w-]*)/g)].map((m) => m[1]);
  const ids = [...compound.matchAll(/#(-?[_a-zA-Z]+[\w-]*)/g)].map((m) => m[1]);
  const attrs = [...compound.matchAll(/\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\s*\]/g)].map(
    (m) => ({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? null })
  );
  // Anything the resolver does not model (pseudo-classes/elements) must not
  // silently count as a match.
  const stripped = compound
    .replace(/\.(-?[_a-zA-Z]+[\w-]*)/g, "")
    .replace(/#(-?[_a-zA-Z]+[\w-]*)/g, "")
    .replace(/\[\s*[\w-]+\s*(?:=\s*(?:"[^"]*"|'[^']*'|[^\]]+))?\s*\]/g, "")
    .replace(/^[a-zA-Z][\w-]*/, "");
  return { tag, classes, ids, attrs, unsupported: stripped.trim() };
}

function compoundMatches(compound: string, element: Element): boolean {
  const parsed = parseCompound(compound);
  if (parsed.unsupported !== "") return false;
  if (parsed.tag !== null && parsed.tag !== element.tag) return false;
  if (parsed.ids.length > 0) return false; // the subject and its ancestors carry no id
  for (const cls of parsed.classes) {
    if (!element.classes.includes(cls)) return false;
  }
  for (const attr of parsed.attrs) {
    const actual = element.attrs[attr.name];
    if (actual === undefined) return false;
    if (attr.value !== null && attr.value !== actual) return false;
  }
  return true;
}

/** Would the browser match this selector against `<div class="shell">` here? */
function selectorMatches(selector: string, viewport: Viewport): boolean {
  const parts = selector.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (!compoundMatches(parts[parts.length - 1], SUBJECT)) return false;
  const ancestors = ancestorsFor(viewport);
  let start = 0;
  for (let p = parts.length - 2; p >= 0; p -= 1) {
    let found = -1;
    for (let a = start; a < ancestors.length; a += 1) {
      if (compoundMatches(parts[p], ancestors[a])) {
        found = a;
        break;
      }
    }
    if (found === -1) return false;
    start = found + 1;
  }
  return true;
}

/** Evaluate a media condition list; unknown features fail loudly, not silently. */
function mediaApplies(media: string | null, viewport: Viewport): boolean {
  if (media === null) return true;
  return media.split(",").some((rawClause) => {
    const clause = rawClause.trim();
    if (clause === "" || clause === "all") return true;
    const features = [...clause.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
    if (features.length === 0) return false;
    return features.every((feature) => {
      const max = /^max-width:\s*([\d.]+)px$/.exec(feature);
      if (max) return viewport.width <= parseFloat(max[1]);
      const min = /^min-width:\s*([\d.]+)px$/.exec(feature);
      if (min) return viewport.width >= parseFloat(min[1]);
      // The only other condition in this stylesheet is prefers-reduced-motion;
      // this suite runs without a reduced-motion preference.
      if (/^prefers-reduced-motion:/.test(feature)) return false;
      throw new Error(`kid453 cascade resolver: unsupported media feature "${feature}"`);
    });
  });
}

/** Specificity as (ids, classes+attrs+pseudos, types) — enough for this stylesheet. */
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#(-?[_a-zA-Z]+[\w-]*)/g) ?? []).length;
  const classes =
    (selector.match(/\.(-?[_a-zA-Z]+[\w-]*)/g) ?? []).length +
    (selector.match(/\[[^\]]*\]/g) ?? []).length +
    (selector.match(/::?[\w-]+/g) ?? []).length;
  const types = (selector.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) ?? []).length;
  return [ids, classes, types];
}

function beats(a: CascadeRule, b: CascadeRule): boolean {
  const sa = specificity(a.selector);
  const sb = specificity(b.selector);
  for (let i = 0; i < 3; i += 1) {
    if (sa[i] !== sb[i]) return sa[i] > sb[i];
  }
  return a.order > b.order;
}

/** The declaration a browser applies to `.shell` for this viewport. */
function resolveGridTemplateColumns(viewport: Viewport): ResolvedDeclaration | null {
  const rules = parseRules(CSS).filter(
    (rule) =>
      "grid-template-columns" in rule.declarations &&
      mediaApplies(rule.media, viewport) &&
      selectorMatches(rule.selector, viewport)
  );
  if (rules.length === 0) return null;
  const winner = rules.reduce((best, rule) => (beats(rule, best) ? rule : best));
  return {
    value: winner.declarations["grid-template-columns"],
    selector: winner.selector,
    media: winner.media,
  };
}

describe("KID-453 portal shell grid cascade", () => {
  it("should give .shell the 220px + 1fr tracks at 1080px in both directions", () => {
    const ltr = resolveGridTemplateColumns({ dir: "ltr", width: 1080 });
    const rtl = resolveGridTemplateColumns(DESKTOP);

    expect(ltr?.value).toBe("220px 1fr");
    expect(rtl?.value).toBe("220px 1fr");
    // RTL must fall back on the base rule — no direction-scoped track override.
    expect(rtl?.selector).toBe(".shell");
    expect(rtl?.media).toBeNull();
  });

  it("should give .shell a single 1fr track at the 720px breakpoint in both directions", () => {
    const ltr = resolveGridTemplateColumns({ dir: "ltr", width: 720 });
    const rtl = resolveGridTemplateColumns(PHONE);

    expect(ltr?.value).toBe("1fr");
    expect(rtl?.value).toBe("1fr");
    expect(rtl?.media).toContain("max-width: 720px");
  });

  it("should not let any dir=rtl rule declare grid-template-columns for .shell", () => {
    const rtlScoped = parseRules(CSS).filter(
      (rule) =>
        "grid-template-columns" in rule.declarations &&
        /dir\s*=\s*["']?rtl/.test(rule.selector)
    );
    expect(rtlScoped).toEqual([]);
  });

  it("should resolve the same declaration source for LTR and RTL at every width", () => {
    for (const width of [720, 721, 820, 1080, 1920]) {
      const ltr = resolveGridTemplateColumns({ dir: "ltr", width });
      const rtl = resolveGridTemplateColumns({ dir: "rtl", width });
      expect(rtl, `width ${width}`).toEqual(ltr);
    }
  });

  it("should keep the sidebar on the inline start of the grid for the given direction", () => {
    // Track 1 is `220px` and holds `aside.shell-side` first in the DOM, so RTL
    // renders it on the right (1080 - 220 = 860 for main) — the acceptance
    // geometry this cascade must keep producing.
    const rtl = resolveGridTemplateColumns(DESKTOP);
    const [track1, track2] = rtl!.value.split(/\s+/);
    expect(track1).toBe("220px");
    expect(track2).toBe("1fr");
  });
});
