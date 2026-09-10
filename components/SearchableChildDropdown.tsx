"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type Child = { id: string; first_name: string; last_name: string };

type Props = {
  children: Child[];
  name: string;
  placeholder?: string;
};

export default function SearchableChildDropdown({ children: kids, name, placeholder }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const filtered = kids.filter((c) => {
    const q = query.toLowerCase();
    return (
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
      c.first_name.toLowerCase().includes(q) ||
      c.last_name.toLowerCase().includes(q)
    );
  });

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const label =
    selected.size === 0
      ? (placeholder || "Select children…")
      : `${selected.size} child${selected.size > 1 ? "ren" : ""} selected`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "8px 12px",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          background: "var(--color-surface)",
          fontFamily: "var(--brand-font)",
          fontSize: 14,
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ opacity: selected.size === 0 ? 0.6 : 1 }}>{label}</span>
        <span style={{ fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            marginTop: 4,
            maxHeight: 240,
            overflowY: "auto",
            zIndex: 50,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search children…"
            autoFocus
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "none",
              borderBottom: "1px solid var(--color-border)",
              fontFamily: "var(--brand-font)",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {filtered.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--color-muted)" }}>
              No children found
            </div>
          )}
          {filtered.map((c) => (
            <label
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                cursor: "pointer",
                fontSize: 14,
                background: selected.has(c.id) ? "color-mix(in srgb, var(--brand-primary) 8%, transparent)" : "transparent",
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                style={{ accentColor: "var(--brand-primary)" }}
              />
              {c.first_name} {c.last_name}
            </label>
          ))}
        </div>
      )}
      {Array.from(selected).map((cid) => (
        <input key={cid} type="hidden" name={name} value={cid} />
      ))}
    </div>
  );
}
