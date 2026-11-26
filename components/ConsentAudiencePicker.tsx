"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { tr, type Dict } from "@/lib/i18n";
import { isAdminRole } from "@/lib/role";

export type AudienceRoom = { id: string; name: string };

type Props = {
  rooms: AudienceRoom[];
  role: string;
  assignedRoomIds: string[];
  dict: Dict;
  defaultOpen?: boolean;
};

// KID-2494: the consent composer offers two audiences: all / general (no
// picks) or one or more classrooms. The founder removed per-child picking from
// this form, so the picker no longer lists children. The server still creates
// one consent_request row per targeted child, which keeps per-child response
// tracking intact. Visual language mirrors components/RecipientsPicker.tsx
// (KID-2482) for consistency: same trigger, checkbox rows and summary label.
export default function ConsentAudiencePicker({
  rooms,
  role,
  assignedRoomIds,
  dict,
  defaultOpen = false,
}: Props) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const [roomIds, setRoomIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);

  // KID-2494: use the shared role helper so the owner keeps the same all-room
  // scope as the admin. A local owner|admin switch drifts when roles change.
  const isAdmin = isAdminRole(role);
  const visibleRooms = useMemo(() => {
    if (isAdmin) return rooms;
    const allowed = new Set(assignedRoomIds);
    return rooms.filter((r) => allowed.has(r.id));
  }, [rooms, isAdmin, assignedRoomIds]);

  const toggleRoom = useCallback((id: string) => {
    setRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setRoomIds(new Set());
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedRoomNames = visibleRooms.filter((r) => roomIds.has(r.id)).map((r) => r.name);
  const isEmpty = roomIds.size === 0;
  const label = isEmpty
    ? t("consents.childAll")
    : t("parent.pickerChannelsClassrooms", { rooms: selectedRoomNames.join(", ") });

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
          <div style={{ padding: "8px 12px" }}>
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
        </div>
      )}

      {Array.from(roomIds).map((rid) => (
        <input key={rid} type="hidden" name="recipientRoomIds" value={rid} />
      ))}
    </div>
  );
}
