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

/** Pull a `@media (max-width: 720px) { ... }` block that contains `marker`. */
function phoneBlock(marker: string): string {
  const blocks = [...css.matchAll(/@media\s*\(max-width:\s*720px\)\s*\{/g)];
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

  it("collapses the Messages two-pane layout to one pane below 720px", () => {
    const block = phoneBlock(".messages-layout");
    expect(block).toContain("grid-template-columns: minmax(0, 1fr) !important");
    expect(block).toMatch(/\.messages-layout\.messages-has-selection \.messages-list\s*\{[^}]*display:\s*none/);
    expect(block).toMatch(
      /\.messages-layout:not\(\.messages-has-selection\) \.messages-thread\s*\{[^}]*display:\s*none/
    );
    // Outside the media query the back link stays hidden on desktop.
    expect(css).toMatch(/\.messages-back\s*\{[^}]*display:\s*none/);
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
