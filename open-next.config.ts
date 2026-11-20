import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// KID-2452: OpenNext Cloudflare adapter. R2 is deliberately not bound: media
// lives in Supabase Storage (founder decision on KID-215) and the app has no
// user-facing ISR/route cache today, so the default in-memory cache is used.
// Revisit with an R2 incremental cache when a cacheable route needs it.
export default defineCloudflareConfig({});
