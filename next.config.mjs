/** @type {import('next').NextConfig} */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
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