// KID-227: a native color picker beside the hex field on the create-daycare
// form, kept in sync both ways — the picker writes #RRGGBB into the text
// input, and a valid typed hex recolors the picker. The text input keeps the
// form `name`, so the server still receives exactly the field it validated
// before (platformColor() in lib/actions.ts, #RRGGBB only) — the picker is
// unnamed and never submitted. Client-side because the sync is pure UI.
"use client";

import { useState } from "react";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export default function ColorField({
  name,
  pickerDefault,
  hexPlaceholder,
  pickerLabel,
  hexLabel,
}: {
  name: string;
  /** Initial picker color (lowercased) — also what an empty field falls back to server-side. */
  pickerDefault: string;
  hexPlaceholder: string;
  pickerLabel: string;
  hexLabel: string;
}) {
  const [hex, setHex] = useState("");
  const [picker, setPicker] = useState(pickerDefault.toLowerCase());
  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        type="color"
        value={picker}
        onChange={(e) => {
          setPicker(e.target.value);
          setHex(e.target.value.toUpperCase());
        }}
        style={{
          width: 44,
          height: 44,
          padding: 2,
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          background: "var(--color-surface)",
          cursor: "pointer",
          flex: "none",
        }}
        aria-label={pickerLabel}
      />
      <input
        className="input"
        name={name}
        value={hex}
        onChange={(e) => {
          setHex(e.target.value);
          const v = e.target.value.trim();
          if (HEX_RE.test(v)) setPicker(v.toLowerCase());
        }}
        placeholder={hexPlaceholder}
        pattern="^#[0-9a-fA-F]{6}$"
        style={{ width: 110, marginBottom: 0 }}
        aria-label={hexLabel}
      />
    </span>
  );
}
