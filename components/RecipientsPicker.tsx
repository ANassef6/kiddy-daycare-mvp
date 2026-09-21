"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";

export type PickerChild = {
  id: string;
  first_name: string;
  last_name: string;
  room_id?: string | null;
  room_name?: string | null;
};
export type PickerRoom = { id: string; name: string };

type Props = {
  children: PickerChild[];
  rooms: PickerRoom[];
  role: string;
  assignedRoomIds: string[];
  childName?: string;
  channelName?: string;
  roomName?: string;
  placeholder?: string;
};

// KID-53 #1 / KID-104 #6: recipients picker with pre-defined channels. The
// Center (everyone) channel is admin-only; staff see their assigned classrooms
// only. "All classrooms" for admins becomes "My classrooms" for staff. Picking
// a child clears the channel and vice versa, so a post goes to exactly one
// target.
export default function RecipientsPicker({
  children: kids,
  rooms,
  role,
  assignedRoomIds,
  childName = "childIds",
  channelName = "recipientChannel",
  roomName = "recipientRoomIds",
  placeholder = "Choose recipients…",
}: Props) {
  const [channel, setChannel] = useState("");
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    const q = query.toLowerCase();
    return `${c.first_name} ${c.last_name}`.toLowerCase().includes(q);
  });

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setChannel("");
  }, []);

  const pickChannel = useCallback((value: string, roomsForChannel: string[]) => {
    setChannel(value);
    setRoomIds(roomsForChannel);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const channelLabel = channel === "center" ? "Center (everyone)"
    : channel === "rooms" && roomIds.length > 0
    ? `Classrooms: ${visibleRooms.filter((r) => roomIds.includes(r.id)).map((r) => r.name).join(", ")}`
    : "";

  const label = channelLabel || (selected.size === 0 ? placeholder : `${selected.size} child${selected.size > 1 ? "ren" : ""} selected`);

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
        <span style={{ opacity: channel || selected.size ? 1 : 0.6 }}>{label}</span>
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
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 60,
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          }}
        >
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
            <div className="small muted" style={{ fontWeight: 700, marginBottom: 6 }}>Pre-defined channels</div>
            {isAdmin && (
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 14 }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <input
                  type="radio"
                  name={channelName}
                  value="center"
                  checked={channel === "center"}
                  onChange={() => pickChannel("center", [])}
                  style={{ accentColor: "var(--brand-primary)" }}
                />
                Center — everyone in the daycare
              </label>
            )}
            <label
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 14 }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <input
                type="radio"
                name={channelName}
                value="rooms"
                checked={channel === "rooms"}
                onChange={() => pickChannel("rooms", visibleRooms.map((r) => r.id))}
                style={{ accentColor: "var(--brand-primary)" }}
              />
              {isAdmin
                ? "All classrooms"
                : visibleRooms.length
                ? "My classrooms"
                : "My classrooms (none assigned yet)"}
            </label>
            {channel === "rooms" && visibleRooms.length > 1 && (
              <div style={{ padding: "4px 0 6px 26px", display: "flex", flexDirection: "column", gap: 4 }}>
                {visibleRooms.map((r) => (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={roomIds.includes(r.id)}
                      onChange={() =>
                        setRoomIds((prev) => (prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]))
                      }
                      style={{ accentColor: "var(--brand-primary)" }}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            )}
          </div>

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
          {visibleChildren.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--color-muted)" }}>
              No children {isAdmin ? "" : "in your classrooms"} yet.
            </div>
          )}
          {filtered.length === 0 && visibleChildren.length > 0 && (
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--color-muted)" }}>No children found</div>
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
              {c.room_name ? <span className="muted small">({c.room_name})</span> : null}
            </label>
          ))}
        </div>
      )}

      {channel && <input type="hidden" name={channelName} value={channel} />}
      {channel === "rooms" && roomIds.map((rid) => <input key={rid} type="hidden" name={roomName} value={rid} />)}
      {Array.from(selected).map((cid) => (
        <input key={cid} type="hidden" name={childName} value={cid} />
      ))}
    </div>
  );
}