// KID-2459: mobile responsiveness guards.
//
// The phone fixes live in three places that are easy to regress without a
// browser: the global phone rules in app/globals.css, the single-pane Messages
// markup/classes, and the EN/AR copy for the back link. This suite pins those
// contracts; the viewport geometry itself is exercised by the Playwright audit
// recorded in docs/evidence/kid2459/.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const css = read("app/globals.css");
const messagesPage = read("app/portal/messages/page.tsx");

/** Pull an `@media (max-width: <width>) { ... }` block that contains `marker`. */
function blockAt(width: string, marker: string): string {
  const escaped = width.replace(/\./g, "\\.");
  const blocks = [...css.matchAll(new RegExp(`@media\\s*\\(max-width:\\s*${escaped}px\\)\\s*\\{`, "g"))];
  for (const match of blocks) {
    let depth = 1;
    let i = (match.index ?? 0) + match[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    const body = css.slice(start, i - 1);
    if (body.includes(marker)) return body;
  }
  return "";
}

/** Pull a `@media (max-width: 720px) { ... }` block that contains `marker`. */
function phoneBlock(marker: string): string {
  return blockAt("720", marker);
}

describe("KID-2459 mobile responsiveness", () => {
  it("keeps the phone shell on one shrinkable track", () => {
    const block = phoneBlock(".shell {");
    expect(block).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("lets data tables scroll inside their card instead of the page", () => {
    const block = phoneBlock("table {");
    expect(block).toMatch(/display:\s*block/);
    expect(block).toMatch(/max-width:\s*100%/);
    expect(block).toMatch(/overflow-x:\s*auto/);
  });

  it("lets in-row upload forms and file inputs shrink and wrap", () => {
    const block = phoneBlock(".row form");
    expect(block).toMatch(/\.row form\s*\{[^}]*min-width:\s*0/);
    expect(block).toMatch(/flex-wrap:\s*wrap/);
    expect(block).toMatch(/input\[type="file"\]\s*\{[^}]*max-width:\s*100%/);
  });

  it("lets long list rows wrap instead of pushing their badges off-screen", () => {
    const block = phoneBlock(".list-item {");
    expect(block).toMatch(/\.list-item\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(block).toMatch(/\.list-item\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(block).toMatch(/\.list-item > \*\s*\{[^}]*min-width:\s*0/);
  });

  it("keeps the wide finance transactions table in its own scroll box", () => {
    expect(read("app/portal/finance/page.tsx")).toContain('<div className="table-scroll mt-3">');
  });

  it("collapses the Messages two-pane layout to one pane below 1024px", () => {
    const block = blockAt("1023.98", ".messages-layout");
    expect(block).toContain("grid-template-columns: minmax(0, 1fr) !important");
    expect(block).toMatch(/\.messages-layout\.messages-has-selection \.messages-list\s*\{[^}]*display:\s*none/);
    expect(block).toMatch(
      /\.messages-layout:not\(\.messages-has-selection\) \.messages-thread\s*\{[^}]*display:\s*none/
    );
    // Both panes can shrink inside the grid, so no child can stretch the page.
    expect(css).toMatch(/\.messages-layout,\s*\n\.messages-layout > \.card\s*\{[^}]*min-width:\s*0/);
    // Outside the media query the back link stays hidden on desktop.
    expect(css).toMatch(/\.messages-back\s*\{[^}]*display:\s*none/);
  });

  it("stacks the Messages composer before the thread pane gets too narrow", () => {
    expect(css).toMatch(/\.messages-composer \.input\s*\{[^}]*flex:\s*1 1 220px/);
    const block = blockAt("1023.98", ".messages-composer");
    expect(block).toMatch(/\.messages-composer \.input,[\s\S]*?flex:\s*1 1 100%/);
    expect(block).toMatch(/\.messages-composer \.btn\s*\{[^}]*min-height:\s*44px/);
  });

  it("marks the Messages panes and only counts an explicit selection", () => {
    expect(messagesPage).toContain('messages-layout${mobileHasSelection ? " messages-has-selection" : ""}');
    expect(messagesPage).toContain('className="card messages-list"');
    expect(messagesPage).toContain('className="card messages-thread"');
    expect(messagesPage).toContain('className="btn btn-ghost small messages-back"');
    expect(messagesPage).toMatch(
      /mobileHasSelection\s*=\s*!!threadId \|\| !!searchParams\.with \|\| searchParams\.compose === "1"/
    );
  });

  it("stacks the Smart Lists builder and the observation goals grid on phones", () => {
    const tags = phoneBlock(".tags-layout");
    expect(tags).toContain("grid-template-columns: minmax(0, 1fr) !important");
    const goals = phoneBlock(".observation-goals-grid");
    expect(goals).toContain("grid-template-columns: minmax(0, 1fr) !important");
  });

  it("has the back-to-conversations copy in both languages", () => {
    expect(getDictionary("en").messages.backToConversations).toBe("Back to conversations");
    expect(getDictionary("ar").messages.backToConversations).toBe("رجوع إلى المحادثات");
  });
});
