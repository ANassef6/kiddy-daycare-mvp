// KID-367 / DEF-006 regression: tapping a child card while the /child/[id]
// prefetch request was still in flight kept the tap completely silent (no URL
// change, no skeleton) for the whole in-flight window — 7.4s under the
// KID-257 audit's stalled network. Next.js reuses the in-flight prefetch
// cache entry for the navigation, so the KID-254 loading boundary only
// engages once the stale request settles.
//
// Fix: the card link stops prefetching (prefetch={false}), so there is no
// in-flight prefetch to join and every tap commits a fresh navigation whose
// loading boundary (app/child/[id]/loading.tsx) renders instantly.
//
// The suite runs in node (no DOM/browser), so the tap-vs-prefetch race is
// pinned the same way tests/unit/kid239 and kid205-style source guards pin
// renderer-invisible properties: by asserting the exact markup contract of
// the card component plus a static guard over the page/card sources.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";

import ChildCard from "@/components/ChildCard";

const ROOT = process.cwd();
// Comments are stripped before source guards: the assertions must pin the
// JSX contract, not prose.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const PAGE_SRC = stripComments(fs.readFileSync(path.join(ROOT, "app", "child", "page.tsx"), "utf8"));
const CARD_SRC = stripComments(fs.readFileSync(path.join(ROOT, "components", "ChildCard.tsx"), "utf8"));

function cardMarkup(href: string, children: string) {
  return renderToStaticMarkup(
    <ChildCard href={href}>
      <div>{children}</div>
    </ChildCard>
  );
}

describe("ChildCard (KID-367): the child card never prefetches /child/[id]", () => {
  it("renders the card as an anchor that navigates to the child detail route", () => {
    const markup = cardMarkup("/child/child-1", "Ella Nguyen");
    expect(markup).toContain('href="/child/child-1"');
    expect(markup).toContain('class="card"');
    expect(markup).toContain("Ella Nguyen");
  });

  it("sets prefetch={false} on the Link so no viewport prefetch of /child/[id] can start", () => {
    // The defect exists precisely because a default Link prefetched the
    // detail route, leaving a request in flight whose cache entry the tap
    // navigation joined (silent tap, no skeleton, no URL change). This pin
    // is the whole fix.
    expect(CARD_SRC).toContain('prefetch={false}');
  });

  it("prefetch={false} is on the Link itself, not some unrelated prop", () => {
    const linkTag = CARD_SRC.match(/<Link[^>]*/)?.[0] ?? "";
    expect(linkTag).toContain("href={href}");
    expect(linkTag).toContain("prefetch={false}");
  });

  it("app/child routes every child card through ChildCard (no direct <Link> to /child/[id])", () => {
    expect(PAGE_SRC).toContain("<ChildCard");
    expect(PAGE_SRC).not.toMatch(/<Link[^>]*href=\{`\/child\/\$\{/);
    expect(PAGE_SRC).not.toContain('import Link from "next/link"');
  });

  it("the KID-254 loading boundary still engages for the fresh navigation", async () => {
    const { default: Loading } = await import("@/app/child/[id]/loading");
    // The card itself owns no loading state — the boundary renders it — so the
    // served card markup carries no busy/progress indicator.
    expect(cardMarkup("/child/child-1", "x")).not.toContain("aria-busy");
    const html = renderToStaticMarkup(Loading());
    expect(html).toContain("aria-busy");
  });
});
