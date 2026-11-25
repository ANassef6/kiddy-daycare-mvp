"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { tr, type Dict } from "@/lib/i18n";

export type PickerChild = {
  id: string;
  first_name: string;
  last_name: string;
  room_id?: string | null;
  room_name?: string | null;
};
export type PickerRoom = { id: string; name: string };

type Props = {
  childOptions: PickerChild[];
  rooms: PickerRoom[];
  role: string;
  assignedRoomIds: string[];
  childName?: string;
  channelName?: string;
  roomName?: string;
  placeholder?: string;
  // Optional open state for server-rendered previews/tests; production uses
  // the closed default.
  defaultOpen?: boolean;
  // KID-221: the picker used to render English-only labels ("Center
  // (everyone)", "My classrooms", the child counts and the empty states)
  // inside an Arabic shell. Every caller passes the active locale dictionary
  // and every visible string goes through it.
  dict: Dict;
};

// KID-53 #1 / KID-104 #6 / KID-2482: recipients picker with pre-defined
// channels. Admins get one "Everyone (whole center)" bulk channel that the
// server resolves against every classroom at submit time (so a classroom
// created after this page rendered is still included). Staff keep their
// assigned classrooms only. The classroom checkboxes stay for targeted picks;
// unchecking any room for an admin narrows the post to the selected rooms.
// Picking a child clears the channel and vice versa, so a post goes to exactly
// one target.
export default function RecipientsPicker({
  childOptions: kids,
  rooms,
  role,
  assignedRoomIds,
  childName = "childIds",
  channelName = "recipientChannel",
  roomName = "recipientRoomIds",
  dict,
  placeholder,
  defaultOpen = false,
}: Props) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const [channel, setChannel] = useState("");
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(defaultOpen);
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

  // KID-2482: the bulk option is one channel for admins. Keep the effective
  // room selection in sync with it so the checkbox list can narrow the post
  // without adding a second "All classrooms" radio.
  const allRoomIds = useMemo(() => visibleRooms.map((r) => r.id), [visibleRooms]);
  const effectiveRoomIds = channel === "center" ? allRoomIds : roomIds;

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

  const pickEveryone = useCallback(() => {
    setChannel("center");
    setRoomIds(allRoomIds);
    setSelected(new Set());
  }, [allRoomIds]);

  const toggleRoom = useCallback(
    (id: string) => {
      const next = effectiveRoomIds.includes(id)
        ? effectiveRoomIds.filter((x) => x !== id)
        : [...effectiveRoomIds, id];
      setRoomIds(next);
      setSelected(new Set());
      // All rooms checked again means the whole center; a subset falls back to
      // the targeted classroom channel.
      setChannel(next.length > 0 && next.length === allRoomIds.length ? "center" : "rooms");
    },
    [effectiveRoomIds, allRoomIds]
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const channelLabel = channel === "center" ? t("parent.pickerEveryone")
    : channel === "rooms" && roomIds.length > 0
    ? t("parent.pickerChannelsClassrooms", { rooms: visibleRooms.filter((r) => roomIds.includes(r.id)).map((r) => r.name).join(", ") })
    : "";

  const label = channelLabel || (selected.size === 0
    ? (placeholder ?? t("parent.pickerChoose"))
    : selected.size === 1
      ? t("parent.pickerSelectedOne", { count: selected.size })
      : t("parent.pickerSelectedMany", { count: selected.size }));

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
            <div className="small muted" style={{ fontWeight: 700, marginBottom: 6 }}>{t("parent.pickerPredefined")}</div>
            {isAdmin ? (
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 14 }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <input
                  type="radio"
                  name={channelName}
                  value="center"
                  checked={channel === "center"}
                  onChange={pickEveryone}
                  style={{ accentColor: "var(--brand-primary)" }}
                />
                {t("parent.pickerEveryone")}
              </label>
            ) : (
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 14 }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <input
                  type="radio"
                  name={channelName}
                  value="rooms"
                  checked={channel === "rooms"}
                  onChange={() => pickChannel("rooms", allRoomIds)}
                  style={{ accentColor: "var(--brand-primary)" }}
                />
                {visibleRooms.length ? t("parent.pickerMyClassrooms") : t("parent.pickerMyClassroomsNone")}
              </label>
            )}
            {(channel === "center" || channel === "rooms") && visibleRooms.length > 1 && (
              <div style={{ padding: "4px 0 6px 26px", display: "flex", flexDirection: "column", gap: 4 }}>
                {visibleRooms.map((r) => (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={effectiveRoomIds.includes(r.id)}
                      onChange={() => toggleRoom(r.id)}
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
            placeholder={t("parent.pickerSearchChildren")}
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