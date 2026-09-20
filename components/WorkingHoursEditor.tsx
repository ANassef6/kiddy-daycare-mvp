"use client";

import { useState, useTransition } from "react";
import { saveWorkingHoursAction } from "@/lib/actions";
import { DAY_LABELS } from "@/lib/working-hours";

// Per-day open/close editor for the Settings tab (KID-55 item 3 / KID-58).
// A checked "Closed" row disables its time inputs; saving persists to the
// institute's opening-hours config, which drives the check-in gate and the
// auto check-out sweep.
export function WorkingHoursEditor({
  week,
  t,
}: {
  week: Record<string, { open: string; close: string }>;
  t: {
    day: string;
    open: string;
    close: string;
    closed: string;
    save: string;
    help: string;
    saved: string;
  };
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [closed, setClosed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(DAY_LABELS.map((_, i) => [String(i), !week[String(i)]]))
  );

  return (
    <form
      className="mt-3"
      action={(fd) =>
        start(async () => {
          setMessage(null);
          const res = await saveWorkingHoursAction(fd);
          if (res && "error" in res && res.error) setMessage({ text: res.error, error: true });
          else setMessage({ text: t.saved });
        })
      }
    >
      <table className="data">
        <thead>
          <tr>
            <th>{t.day}</th>
            <th>{t.open}</th>
            <th>{t.close}</th>
            <th>{t.closed}</th>
          </tr>
        </thead>
        <tbody>
          {DAY_LABELS.map((label, i) => {
            const key = String(i);
            const conf = week[key];
            const isClosed = !!closed[key];
            return (
              <tr key={key}>
                <td>
                  <strong>{label}</strong>
                  {key === String(new Date().getDay()) && (
                    <span className="small muted"> · today</span>
                  )}
                </td>
                <td>
                  <input
                    className="input"
                    type="time"
                    name={`open_${key}`}
                    defaultValue={isClosed ? "" : (conf?.open ?? "")}
                    disabled={isClosed}
                    style={{ maxWidth: 140 }}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="time"
                    name={`close_${key}`}
                    defaultValue={isClosed ? "" : (conf?.close ?? "")}
                    disabled={isClosed}
                    style={{ maxWidth: 140 }}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    name={`closed_${key}`}
                    checked={isClosed}
                    onChange={(e) => setClosed((prev) => ({ ...prev, [key]: e.target.checked }))}
                    title={t.closed}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted mt-2">{t.help}</p>
      {message && (
        <p
          className="small"
          style={{ color: message.error ? "#dc2626" : "#047857", fontWeight: 600 }}
        >
          {message.text}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "…" : t.save}
      </button>
    </form>
  );
}