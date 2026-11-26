"use client";

import { useMemo, useState } from "react";

export type ChecklistItem = { id: string; label: string };

type Props = {
  name: string;
  items: ChecklistItem[];
  placeholder: string;
  emptyMessage: string;
  noResultsMessage: string;
};

// KID-2482: the messages composer's recipient list had no search while every
// other recipient surface did. Same filter, same localized placeholders.
export default function SearchableChecklist({
  name,
  items,
  placeholder,
  emptyMessage,
  noResultsMessage,
}: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <>
      <input
        className="input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{ marginBottom: 8 }}
      />
      {items.length === 0 && <p className="muted small">{emptyMessage}</p>}
      {items.length > 0 && filtered.length === 0 && <p className="muted small">{noResultsMessage}</p>}
      {filtered.map((item) => (
        <label key={item.id} className="row small" style={{ gap: 8, alignItems: "center", padding: "4px 0" }}>
          <input type="checkbox" name={name} value={item.id} />
          <span>{item.label}</span>
        </label>
      ))}
    </>
  );
}
