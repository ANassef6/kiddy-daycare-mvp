"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { setNewsfeedPhotoTagsAction } from "@/lib/actions";
import { tr, type Dict } from "@/lib/i18n";

type ViewerChild = { id: string; first_name: string; last_name: string };

// KID-2487: staff photo viewer. Opening a post photo shows a lightbox with a
// searchable child checklist. Saving links the children to the same stored
// object via the media table; unchecking a child removes only that link. The
// server re-checks the room scope and the post's audience before it writes.
export default function NewsfeedPhotoViewer({
  postId,
  imageSrc,
  canTag,
  childOptions,
  taggedChildIds,
  dict,
}: {
  postId: string;
  imageSrc: string;
  canTag: boolean;
  childOptions: ViewerChild[];
  taggedChildIds: string[];
  dict: Dict;
}) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(taggedChildIds));
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return childOptions;
    return childOptions.filter((child) =>
      `${child.first_name} ${child.last_name}`.toLowerCase().includes(q)
    );
  }, [childOptions, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("newsfeed.openPhoto")}
        style={{
          display: "block",
          width: "100%",
          padding: 0,
          border: "none",
          background: "none",
          cursor: "zoom-in",
          marginTop: 10,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt=""
          style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 8 }}
        />
      </button>

      {open ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("newsfeed.photoViewer")}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0, 0, 0, 0.82)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            overflowY: "auto",
            padding: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("common.close")}
              style={{
                border: "none",
                borderRadius: 999,
                background: "rgba(255,255,255,0.9)",
                color: "#111",
                width: 36,
                height: 36,
                fontSize: 18,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              justifyContent: "center",
              alignItems: "flex-start",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageSrc}
              alt=""
              style={{
                maxWidth: "min(92vw, 900px)",
                maxHeight: "70vh",
                objectFit: "contain",
                borderRadius: 8,
              }}
            />
            {canTag ? (
              <form
                action={setNewsfeedPhotoTagsAction}
                style={{
                  background: "var(--color-surface, #fff)",
                  color: "var(--color-text, #111)",
                  borderRadius: 10,
                  padding: 12,
                  width: "min(92vw, 320px)",
                  maxHeight: "70vh",
                  overflowY: "auto",
                }}
              >
                <input type="hidden" name="postId" value={postId} />
                <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>{t("newsfeed.tagChildren")}</h3>
                <p className="small muted" style={{ margin: "0 0 8px" }}>
                  {t("newsfeed.tagHint")}
                </p>
                <input
                  className="input"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("newsfeed.tagSearch")}
                  style={{ width: "100%", boxSizing: "border-box", marginBottom: 8 }}
                />
                {filtered.length === 0 ? (
                  <p className="small muted" style={{ margin: "4px 0" }}>
                    {t("newsfeed.tagNoMatch")}
                  </p>
                ) : null}
                <div>
                  {filtered.map((child) => (
                    <label
                      key={child.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 0",
                        cursor: "pointer",
                        fontSize: 14,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(child.id)}
                        onChange={() => toggle(child.id)}
                        style={{ accentColor: "var(--brand-primary, #3b82f6)" }}
                      />
                      <span>
                        {child.first_name} {child.last_name}
                      </span>
                    </label>
                  ))}
                </div>
                {Array.from(selected).map((childId) => (
                  <input key={childId} type="hidden" name="childIds" value={childId} />
                ))}
                <button className="btn btn-primary" type="submit" style={{ width: "100%", marginTop: 10 }}>
                  {t("newsfeed.saveTags")}
                </button>
                <p className="small muted" style={{ margin: "6px 0 0" }}>
                  {t("newsfeed.tagSelected", { count: selected.size })}
                </p>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
