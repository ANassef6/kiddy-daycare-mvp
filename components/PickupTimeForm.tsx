"use client";

// KID-486: the pickup user's same-day scheduled pickup — save/update in one
// form, cancel beside it. Server-side validation issues come back as {error}
// text (already localized server-side); success redirects to /child?saved=1.
import { useTransition, useState } from "react";
import { savePickupTimeAction, cancelPickupTimeAction } from "@/lib/actions";

export type PickupTimeFormLabels = {
  timeLabel: string;
  noteLabel: string;
  notePlaceholder: string;
  save: string;
  update: string;
  remove: string;
  saving: string;
};

export default function PickupTimeForm({
  childId,
  initialTime = "",
  initialNote = "",
  labels,
}: {
  childId: string;
  initialTime?: string;
  initialNote?: string;
  labels: PickupTimeFormLabels;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ marginTop: 10 }}>
      <form
        className="row"
        style={{ alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          setError(null);
          start(async () => {
            const res = (await savePickupTimeAction(fd)) as { error?: string } | undefined;
            if (res?.error) setError(res.error);
          });
        }}
      >
        <input type="hidden" name="childId" value={childId} />
        <div className="field" style={{ minWidth: 130 }}>
          <label className="label">{labels.timeLabel}</label>
          <input
            className="input"
            type="time"
            name="time"
            defaultValue={initialTime}
            required
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label className="label">{labels.noteLabel}</label>
          <input
            className="input"
            type="text"
            name="note"
            defaultValue={initialNote}
            placeholder={labels.notePlaceholder}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? labels.saving : initialTime ? labels.update : labels.save}
        </button>
      </form>
      {initialTime ? (
        <form action={cancelPickupTimeAction} style={{ marginTop: 8 }}>
          <input type="hidden" name="childId" value={childId} />
          <button className="btn btn-ghost small" type="submit">
            {labels.remove}
          </button>
        </form>
      ) : null}
      {error && (
        <p className="small" style={{ color: "#dc2626", marginTop: 8, fontWeight: 600 }}>
          {error}
        </p>
      )}
    </div>
  );
}
