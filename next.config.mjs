/** @type {import('next').NextConfig} */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  async rewrites() {
    return [
      {
        // KID-443 (defect 2): Digital Asset Links for the per-tenant TWA apps,
        // served as code through app/api/assetlinks + lib/twa.ts (the same
        // per-origin tenancy rule as the tenant surfaces) instead of a static
        // file each deployment can forget.
        source: "/.well-known/assetlinks.json",
        destination: "/api/assetlinks",
      },
    ];
  },
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "pg", "@supabase/supabase-js"],
  },
  webpack: (config) => {
    // Ensure the `@/` alias resolves in every compilation context (server + client).
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": __dirname,
    };
    return config;
  },
};

export default nextConfig;