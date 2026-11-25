"use client";

import { useMemo, useState } from "react";

export type SearchableSelectOption = { id: string; label: string };

type Props = {
  name: string;
  options: SearchableSelectOption[];
  placeholder: string;
  noResultsMessage: string;
  allLabel?: string;
  defaultValue?: string;
  required?: boolean;
};

// KID-2482: the homework child picker (and the other single-child selects)
// needed the same search the recipients picker already had. The search field
// filters the options only; the submitted value stays a plain select value.
export default function SearchableSelect({
  name,
  options,
  placeholder,
  noResultsMessage,
  allLabel,
  defaultValue = "",
  required,
}: Props) {
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(defaultValue || (allLabel === undefined ? options[0]?.id ?? "" : ""));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, query]);

  // Keep the current pick visible while the search narrows the list, so the
  // select never silently shows a different child.
  const visible = useMemo(() => {
    if (!value || filtered.some((option) => option.id === value)) return filtered;
    const selected = options.find((option) => option.id === value);
    return selected ? [selected, ...filtered] : filtered;
  }, [filtered, options, value]);

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
      <select
        className="select"
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
      >
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {visible.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
      {options.length > 0 && filtered.length === 0 && (
        <p className="muted small" style={{ margin: "4px 0 0" }}>{noResultsMessage}</p>
      )}
    </>
  );
}
