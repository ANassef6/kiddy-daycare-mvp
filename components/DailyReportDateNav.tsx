"use client";

// KID-472 item 4: the shared date navigation for the daily report, rendered
// by both the staff editor (app/portal/children/[id]) and the parent read view
// (app/child/[id]). Navigation is URL-based (?date=… on the same page) so the
// server refetches the selected day's report; the server validates the value
// through configuredReportDate() — this component only navigates.
//
// When `formId` is given (staff editor), the component watches that form for
// edits and confirms before navigating away from unsaved changes. The parent
// view has no form and mounts without the guard.

import { useEffect, useRef, useState } from "react";
import { isIsoDate, shiftIsoDate, recentDatesUpTo } from "@/lib/report-dates";

export type DateNavLabels = {
  prev: string;
  next: string;
  today: string;
  pickDate: string;
  unsaved?: string;
};

export default function DailyReportDateNav({
  basePath,
  tab,
  date,
  today,
  labels,
  formId,
  stripDays = 7,
  maxDate = today,
}: {
  basePath: string;
  tab?: string;
  date: string;
  today: string;
  labels: DateNavLabels;
  formId?: string;
  stripDays?: number;
  maxDate?: string;
}) {
  const dirtyRef = useRef(false);
  const [blocked, setBlocked] = useState(false);

  // The dirty flag is per loaded date: arriving on a fresh navigation resets
  // it, then any edit inside the watched form re-arms the confirm.
  useEffect(() => {
    dirtyRef.current = false;
    setBlocked(false);
    if (!formId) return;
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const mark = () => {
      dirtyRef.current = true;
    };
    form.addEventListener("input", mark);
    form.addEventListener("change", mark);
    return () => {
      form.removeEventListener("input", mark);
      form.removeEventListener("change", mark);
    };
  }, [formId, date]);

  const nav = (target: string) => {
    if (!isIsoDate(target) || target === date) return;
    if (dirtyRef.current && labels.unsaved && !window.confirm(labels.unsaved)) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    const params = new URLSearchParams();
    if (tab) params.set("tab", tab);
    params.set("date", target);
    // Full-page navigation on purpose: both pages are dynamic server
    // components (?date= drives the server fetch), and the client tab state
    // is re-seeded from the `tab` param on reland (kid180).
    window.location.assign(`${basePath}?${params.toString()}`);
  };

  const atBoundary = (target: string) => target > maxDate;

  const strip = recentDatesUpTo(date, stripDays);

  return (
    <div className="card mb-3" data-testid="daily-report-date-nav">
      <div
        className="row"
        style={{ alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}
      >
        <div className="row" style={{ alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={labels.prev}
            title={labels.prev}
            style={{ fontSize: 13 }}
            onClick={() => nav(shiftIsoDate(date, -1))}
          >
            ‹
          </button>
          <input
            type="date"
            value={date}
            max={maxDate}
            aria-label={labels.pickDate}
            data-testid="daily-report-date-input"
            onChange={(e) => {
              const v = e.target.value;
              if (isIsoDate(v) && !atBoundary(v)) nav(v);
              else if (atBoundary(v)) nav(maxDate);
            }}
            style={{ maxWidth: 170 }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={labels.next}
            title={labels.next}
            disabled={atBoundary(shiftIsoDate(date, 1))}
            style={{ fontSize: 13 }}
            onClick={() => nav(shiftIsoDate(date, 1))}
          >
            ›
          </button>
          <button
            type="button"
            className={date === today ? "badge badge-green" : "badge"}
            style={{ cursor: "pointer", border: "none", fontSize: 12 }}
            onClick={() => nav(today)}
            disabled={date === today}
          >
            {labels.today}
          </button>
        </div>
        <div className="row" style={{ gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {strip.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => nav(d)}
              disabled={d === date}
              className={d === date ? "badge badge-green" : "badge"}
              style={{ cursor: "pointer", border: "none", fontSize: 11 }}
              title={d === date ? d : undefined}
            >
              {d.slice(5)}
            </button>
          ))}
        </div>
      </div>
      {blocked && (
        <p className="small mt-2" style={{ color: "#b45309", margin: 0 }}>
          {labels.unsaved}
        </p>
      )}
    </div>
  );
}
