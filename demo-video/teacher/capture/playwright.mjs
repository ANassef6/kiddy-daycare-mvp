// Resolve Playwright without adding it to the product dependencies.
// Set PLAYWRIGHT_MODULE to a Playwright entry point, or install Playwright in
// demo-video/teacher (see README) so the bare specifier resolves.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", "playwright-core"].filter(Boolean);
  const require = createRequire(import.meta.url);
  const errors = [];
  for (const candidate of candidates) {
    try {
      const resolved = candidate.startsWith("/") || candidate.startsWith(".")
        ? candidate
        : require.resolve(candidate);
      const mod = await import(pathToFileURL(resolved).href);
      return mod.chromium ? mod : mod.default;
    } catch (err) {
      errors.push(`${candidate}: ${err.message}`);
    }
  }
  throw new Error(
    `Playwright is not available. Install it in demo-video/teacher (npm install) or set PLAYWRIGHT_MODULE to its index.mjs.\n${errors.join("\n")}`
  );
}
