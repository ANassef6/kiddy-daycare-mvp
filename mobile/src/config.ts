// API origin for the Kiddy mobile client. Override at build/start time with
// EXPO_PUBLIC_API_URL. Defaults to the current production web deployment where
// /api/mobile/* reuses the same TypeScript/Supabase core as the deployed web app.
export const API_ORIGIN =
  process.env.EXPO_PUBLIC_API_URL ?? "https://kiddy-ab8xqu5rw-kiddy2.vercel.app";

export const BRANDING_DEFAULTS = {
  name: "Kiddy",
  logoUrl: null,
  brandImageUrl: null,
  primaryColor: "#3B82F6",
  accentColor: "#10B981",
  font: "Inter",
} as const;