// KID-306: the Chatwoot support widget is env-configured and fail-off.
//
// Pins the contract: the widget renders only when BOTH
// NEXT_PUBLIC_CHATWOOT_BASE_URL and NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN are
// set; no localhost URL or website token is ever hardcoded in app/ or
// components/; and the example env advertises both keys.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN = ["r4fMkBakhZTbS3VaBUGYbcMZ", "http://localhost:3000"];

type WidgetEnv = { baseURL?: string; token?: string };

// Vars are read at module scope, so every scenario re-imports the component
// under fresh env state and restores the originals afterwards.
let saved: { baseURL?: string; token?: string };
async function withWidgetEnv(env: WidgetEnv, body: () => Promise<void>) {
  saved = {
    baseURL: process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL,
    token: process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN,
  };
  if (env.baseURL === undefined) delete process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL;
  else process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL = env.baseURL;
  if (env.token === undefined) delete process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN;
  else process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN = env.token;
  try {
    await body();
  } finally {
    delete process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL;
    delete process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN;
    if (saved.baseURL !== undefined) process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL = saved.baseURL;
    if (saved.token !== undefined) process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN = saved.token;
  }
}

async function importWidget() {
  vi.resetModules();
  const mod = await import("@/components/ChatwootWidget");
  return mod.default;
}

function walkSources(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walkSources(p);
      return /\.(tsx?|mjs|jsx)$/.test(e.name) ? [p] : [];
    });
}

describe("KID-306: Chatwoot widget is env-gated", () => {
  it("renders nothing when both env vars are unset", async () => {
    await withWidgetEnv({}, async () => {
      const Widget = await importWidget();
      expect(renderToStaticMarkup(<Widget />)).toBe("");
    });
  });

  it("renders nothing when either env var is empty", async () => {
    for (const partial of [{ baseURL: "https://chat.example" }, { token: "tok-123" }]) {
      await withWidgetEnv(partial, async () => {
        const Widget = await importWidget();
        expect(renderToStaticMarkup(<Widget />)).toBe("");
      });
    }
  });

  it("mounts the Chatwoot SDK via next/script with the configured URL when fully configured", async () => {
    await withWidgetEnv({ baseURL: "https://chat.example", token: "tok-123" }, async () => {
      const Widget = await importWidget();
      const props = (Widget() as unknown as { props: { id: string; src: string; strategy: string; onLoad: () => void } }).props;
      expect(props.id).toBe("kiddy-chatwoot-widget");
      expect(props.src).toBe("https://chat.example/packs/js/sdk.js");
      expect(props.strategy).toBe("afterInteractive");
      expect(typeof props.onLoad).toBe("function");
    });
  });

  it("chatwootSDK.run fires exactly once even if the script reports load twice", async () => {
    await withWidgetEnv({ baseURL: "https://chat.example", token: "tok-123" }, async () => {
      const Widget = await importWidget();
      const el = Widget() as unknown as { props: { onLoad: () => void } };
      const calls: Array<{ websiteToken: string; baseUrl: string }> = [];
      const win = { chatwootSDK: { run: (o: { websiteToken: string; baseUrl: string }) => calls.push(o) } };
      const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
      const savedWindow = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = win as unknown;
      try {
        el.props.onLoad();
        el.props.onLoad();
      } finally {
        if (!hadWindow) delete (globalThis as { window?: unknown }).window;
        else (globalThis as { window?: unknown }).window = savedWindow;
      }
      expect(calls).toEqual([{ websiteToken: "tok-123", baseUrl: "https://chat.example" }]);
    });
  });

  it("never hardcodes the dev base URL or token in app/ or components/", () => {
    const sources = ["app", "components"].flatMap((d) => walkSources(path.join(process.cwd(), d)));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const src = fs.readFileSync(file, "utf8");
      for (const s of FORBIDDEN) {
        expect(src.includes(s), `${file} must not hardcode "${s}"`).toBe(false);
      }
    }
  });

  it("the example env advertises both Chatwoot keys", () => {
    const example = fs.readFileSync(path.join(process.cwd(), ".env.local.example"), "utf8");
    expect(example).toContain("NEXT_PUBLIC_CHATWOOT_BASE_URL=");
    expect(example).toContain("NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN=");
  });
});
