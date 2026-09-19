"use client";

import { useState, type ReactNode } from "react";

export type Tab = { id: string; label: string; node: ReactNode };

// KID-53 #2: child profile tabbed layout. Tabs switch client-side without
// reloading; active tab is underlined with the brand accent.
export default function ChildProfileTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div>
      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "2px solid var(--color-border)",
          overflowX: "auto",
          marginBottom: 18,
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === current?.id}
            onClick={() => setActive(t.id)}
            style={{
              padding: "10px 14px",
              border: "none",
              borderBottom: t.id === current?.id ? "2px solid var(--brand-primary)" : "2px solid transparent",
              marginBottom: -2,
              background: "transparent",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: t.id === current?.id ? 700 : 500,
              color: t.id === current?.id ? "var(--brand-primary)" : "var(--color-text)",
              whiteSpace: "nowrap",
              fontFamily: "var(--brand-font)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{current?.node}</div>
    </div>
  );
}