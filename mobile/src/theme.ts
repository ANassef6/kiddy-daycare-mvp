import type { Branding } from "./types";
import { BRANDING_DEFAULTS } from "./config";

export type Palette = {
  primary: string;
  accent: string;
  background: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  danger: string;
  ok: string;
};

export function makeTheme(branding: Branding): Palette {
  const primary = branding.primaryColor ?? BRANDING_DEFAULTS.primaryColor;
  const accent = branding.accentColor ?? BRANDING_DEFAULTS.accentColor;
  return {
    primary,
    accent,
    background: "#F6F7F9",
    card: "#FFFFFF",
    border: "#E7E9EE",
    text: "#1B2130",
    muted: "#6B7280",
    danger: "#DC2626",
    ok: accent,
  };
}

export function initials(first: string, last: string): string {
  return `${(first[0] ?? "").toUpperCase()}${(last[0] ?? "").toUpperCase()}`;
}

export function fullName(first: string, last: string): string {
  return `${first}${last ? ` ${last}` : ""}`.trim();
}