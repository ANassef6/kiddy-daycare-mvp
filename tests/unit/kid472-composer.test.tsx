// KID-475 — the parent/staff messaging composer is usable on a phone.
//
// The board could not send an in-app message from the parent surface. The probe
// of the deployed shape (Chromium, mobile viewports, both locales) found three
// concrete defects and their repairs are pinned here:
//
// OBS-001 Chatwoot launcher overlap: the launcher bubble is a fixed
//   bottom-right overlay that covers the composer's interactive corner — at
//   320x568 elementFromPoint returned the bubble for taps inside the message
//   input. The launcher is now hidden on the two messaging routes and restored
//   elsewhere via the SDK's toggleBubbleVisibility.
// OBS-002 Cramped wrap: at <=720px the `.row` composer wrapped into a sliver
//   input (86px at 390, 56px at 360 in AR), which read as a dead field. The
//   composer now stacks full-width rows at phone widths.
// OBS-003 Silent send: the submit button did not react while the server action
//   ran. MessageComposerForm reacts with a localized pending label, a disabled
//   control and aria-busy during the transition.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import {
  CHATWOOT_BUBBLE_HIDDEN_ROUTES,
  chatwootBubbleShouldHide,
  applyChatwootBubbleVisibility,
  type ChatwootApi,
} from "@/components/ChatwootWidget";
import MessageComposerForm from "@/components/MessageComposerForm";
import { tr, dictionaries } from "@/lib/i18n";

const MESSAGES_PAGE = "app/child/messages/page.tsx";
const WIDGET = "components/ChatwootWidget.tsx";

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("KID-475 OBS-001 the Chatwoot launcher hides on messaging surfaces", () => {
  it("hides on the parent and staff chat routes (path segments only — pathname never carries the query)", () => {
    expect([...CHATWOOT_BUBBLE_HIDDEN_ROUTES].sort()).toEqual(
      ["/child/messages", "/portal/messages"].sort()
    );
    expect(chatwootBubbleShouldHide("/child/messages")).toBe(true);
    expect(chatwootBubbleShouldHide("/portal/messages")).toBe(true);
    expect(chatwootBubbleShouldHide("/child/messages/")).toBe(true);
  });

  it("keeps the launcher on every other surface, including the support page", () => {
    expect(chatwootBubbleShouldHide("/child/support")).toBe(false);
    expect(chatwootBubbleShouldHide("/child/newsfeed")).toBe(false);
    expect(chatwootBubbleShouldHide("/")).toBe(false);
    expect(chatwootBubbleShouldHide("/login")).toBe(false);
    expect(chatwootBubbleShouldHide("/portal")).toBe(false);
    expect(chatwootBubbleShouldHide(undefined)).toBe(false);
  });

  it("applies the visibility once per state change, retries into changed states, and degrades with no SDK", () => {
    vi.stubGlobal("window", {} as typeof window);
    const toggled: ("hide" | "show")[] = [];
    const chatwoot = {
      setUser: () => {},
      toggleBubbleVisibility: (v: "hide" | "show") => {
        toggled.push(v);
      },
    } as ChatwootApi;

    expect(applyChatwootBubbleVisibility(chatwoot, "/child/messages")).toBe(true);
    expect(toggled).toEqual(["hide"]);

    // A navigation that keeps the same state is a no-op.
    expect(applyChatwootBubbleVisibility(chatwoot, "/child/messages")).toBe(true);
    expect(toggled).toEqual(["hide"]);

    expect(applyChatwootBubbleVisibility(chatwoot, "/child/newsfeed")).toBe(true);
    expect(toggled).toEqual(["hide", "show"]);

    // No SDK yet (pre-run or older bundle): one attempt reports not-applied.
    expect(applyChatwootBubbleVisibility(undefined, "/child/messages")).toBe(false);
    // A toggle that throws (SDK DOM not ready yet) reports not-applied so the
    // scheduled retry can land the state when the DOM exists.
    const failing = {
      setUser: () => {},
      toggleBubbleVisibility: () => {
        throw new TypeError("Cannot read properties of null (reading 'classList')");
      },
    } as unknown as ChatwootApi;
    expect(applyChatwootBubbleVisibility(failing, "/child/messages")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("the widget schedules the per-route visibility at navigation and first SDK load", () => {
    const src = readRepo(WIDGET);
    expect((src.match(/scheduleChatwootBubbleVisibility\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("BUBBLE_RETRY_DELAYS_MS");
  });
});

describe("KID-475 OBS-002 the composer stacks full width at phone widths", () => {
  it("both composer forms use the shared composer with tap-testable inputs", () => {
    const src = readRepo(MESSAGES_PAGE);
    // thread reply + direct composer
    expect(src.match(/<MessageComposerForm/g)?.length).toBe(2);
    // The composer class lives once on the shared form component.
    expect(readRepo("components/MessageComposerForm.tsx").match(/messages-composer/g)?.length).toBe(1);
    // The recipient select no longer pins a 260px inline width that CSS could
    // not override (it caused the tiny-input wrap on phones).
    expect(readRepo("components/MessageComposerForm.tsx")).not.toMatch(/maxWidth/);
  });

  it("the phone breakpoint stacks select/input/button full width with 44px targets", () => {
    const css = readRepo("app/globals.css");
    const anchor = css.indexOf("KID-475 — parent/staff messaging composer");
    expect(anchor).toBeGreaterThan(-1);
    const stack = css.indexOf("@media (max-width: 720px) {", anchor);
    expect(stack).toBeGreaterThan(-1);
    const block = css.slice(stack, stack + 500);
    expect(block).toContain("flex: 1 1 100%");
    expect(block).toContain("min-height: 44px");
  });

  it("i18n carries the pending label in EN and AR", () => {
    expect(tr(dictionaries.en, "messages.sending")).toBe("Sending…");
    expect(tr(dictionaries.ar, "messages.sending")).toBe("جارٍ الإرسال…");
  });
});

describe("KID-475 OBS-003 the send reacts while the action runs", () => {
  const baseProps = {
    action: async () => {},
    sendLabel: "Send",
    sendingLabel: "Sending…",
    placeholder: "Write a message…",
  };

  it("renders the idle composer with a pending-aware, testable submit button", () => {
    const html = renderToStaticMarkup(<MessageComposerForm {...baseProps} />);
    expect(html).toContain('placeholder="Write a message…"');
    expect(html).toContain('data-testid="messages-send"');
    expect(html).toContain('data-pending="false"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('data-testid="messages-input"');
    expect(html).toContain("messages-composer");
  });

  it("the direct composer renders the recipient picker with the default selected", () => {
    const html = renderToStaticMarkup(
      <MessageComposerForm
        {...baseProps}
        recipientOptions={[
          { id: "acc-a", label: "Maria Lopez" },
          { id: "acc-b", label: "Round5 Staff" },
        ]}
        defaultRecipientId="acc-a"
      />
    );
    expect(html).toContain("Maria Lopez");
    expect(html).toContain("Round5 Staff");
    expect(html).toMatch(/<option[^>]*value="acc-a"[^>]*selected/);
    // no thread field on the direct composer
    expect(html).not.toContain('name="threadId"');
  });

  it("the thread reply renders the fixed recipient and thread fields", () => {
    const html = renderToStaticMarkup(
      <MessageComposerForm {...baseProps} hiddenRecipientId="acc-a" threadId="t-1" />
    );
    expect(html).toContain('name="threadId" value="t-1"');
    expect(html).toContain('name="recipientId" value="acc-a"');
    expect(html).not.toContain("<select");
  });
});
