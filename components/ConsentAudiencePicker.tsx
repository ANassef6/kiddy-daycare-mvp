"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { tr, type Dict } from "@/lib/i18n";

export type AudienceChild = {
  id: string;
  first_name: string;
  last_name: string;
  room_id?: string | null;
  room_name?: string | null;
};
export type AudienceRoom = { id: string; name: string };

type Props = {
  childOptions: AudienceChild[];
  rooms: AudienceRoom[];
  role: string;
  assignedRoomIds: string[];
  dict: Dict;
  defaultOpen?: boolean;
};

// KID-2494: the consent composer offers three audiences that can also combine:
// all / general (no picks), one or more classrooms, and specific children.
// Classroom and child picks ADD UP (the issue's union rule), unlike the
// announcement picker where picking a child replaces the channel. The server
// resolves classrooms against the roster at submit time and de-duplicates the
// union, so this component only needs to submit the picks it was given.
// Visual language mirrors components/RecipientsPicker.tsx (KID-2482) for
// consistency: same trigger, checkbox rows, child search and summary labels.
export default function ConsentAudiencePicker({
  childOptions: kids,
  rooms,
  role,
  assignedRoomIds,
  dict,
  defaultOpen = false,
}: Props) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const [roomIds, setRoomIds] = useState<Set<string>>(new Set());
  const [childIds, setChildIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);

  const isAdmin = role === "owner" || role === "admin";
  const visibleRooms = useMemo(() => {
    if (isAdmin) return rooms;
    const allowed = new Set(assignedRoomIds);
    return rooms.filter((r) => allowed.has(r.id));
  }, [rooms, isAdmin, assignedRoomIds]);

  const visibleChildren = useMemo(() => {
    if (isAdmin) return kids;
    const allowed = new Set(assignedRoomIds);
    return kids.filter((c) => allowed.has(c.room_id ?? ""));
  }, [kids, isAdmin, assignedRoomIds]);

  const filtered = visibleChildren.filter((c) => {
    const q = query.trim().toLowerCase();
    return `${c.first_name} ${c.last_name}`.toLowerCase().includes(q);
  });

  const toggleRoom = useCallback((id: string) => {
    setRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleChild = useCallback((id: string) => {
    setChildIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setRoomIds(new Set());
    setChildIds(new Set());
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedRoomNames = visibleRooms.filter((r) => roomIds.has(r.id)).map((r) => r.name);
  const summaryParts: string[] = [];
  if (selectedRoomNames.length > 0) {
    summaryParts.push(t("parent.pickerChannelsClassrooms", { rooms: selectedRoomNames.join(", ") }));
  }
  if (childIds.size === 1) {
    summaryParts.push(t("parent.pickerSelectedOne", { count: 1 }));
  } else if (childIds.size > 1) {
    summaryParts.push(t("parent.pickerSelectedMany", { count: childIds.size }));
  }
  const isEmpty = roomIds.size === 0 && childIds.size === 0;
  const label = isEmpty ? t("consents.childAll") : summaryParts.join(" · ");

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
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
        <span style={{ opacity: isEmpty ? 0.6 : 1 }}>{label}</span>
        <span style={{ fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("consents.audience")}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            marginTop: 4,
            maxHeight: 360,
            overflowY: "auto",
            zIndex: 60,
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          }}
        >
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
            <label
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 14, fontWeight: 700 }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <input
                type="checkbox"
                checked={isEmpty}
                onChange={clearAll}
                style={{ accentColor: "var(--brand-primary)" }}
              />
              {t("consents.childAll")}
            </label>

            <div className="small muted" style={{ fontWeight: 700, margin: "6px 0 4px" }}>{t("consents.audienceClassrooms")}</div>
            {visibleRooms.length === 0 && (
              <div style={{ padding: "2px 0 6px", fontSize: 13, color: "var(--color-muted)" }}>{t("consents.audienceNoRooms")}</div>
            )}
            {visibleRooms.map((r) => (
              <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 14, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={roomIds.has(r.id)}
                  onChange={() => toggleRoom(r.id)}
                  style={{ accentColor: "var(--brand-primary)" }}
                />
                {r.name}
              </label>
            ))}
          </div>

          <div className="small muted" style={{ fontWeight: 700, padding: "8px 12px 0" }}>{t("consents.audienceChildren")}</div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("parent.pickerSearchChildren")}
            aria-label={t("parent.pickerSearchChildren")}
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
          {visibleChildren.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--color-muted)" }}>
              {isAdmin ? t("parent.pickerNoChildrenAll") : t("parent.pickerNoChildrenRooms")}
            </div>
          )}
          {filtered.length === 0 && visibleChildren.length > 0 && (
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--color-muted)" }}>{t("parent.pickerNoChildrenFound")}</div>
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
                background: childIds.has(c.id) ? "color-mix(in srgb, var(--brand-primary) 8%, transparent)" : "transparent",
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <input
                type="checkbox"
                checked={childIds.has(c.id)}
                onChange={() => toggleChild(c.id)}
                style={{ accentColor: "var(--brand-primary)" }}
              />
              {c.first_name} {c.last_name}
              {c.room_name ? <span className="muted small">({c.room_name})</span> : null}
            </label>
          ))}
        </div>
      )}

      {Array.from(roomIds).map((rid) => (
        <input key={`room-${rid}`} type="hidden" name="recipientRoomIds" value={rid} />
      ))}
      {Array.from(childIds).map((cid) => (
        <input key={`child-${cid}`} type="hidden" name="childIds" value={cid} />
      ))}
    </div>
  );
}
