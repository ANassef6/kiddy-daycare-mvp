"use client";

import { useTransition, useState } from "react";
import { logStaffStatusAction } from "@/lib/actions";

export type StaffStatusFormLabels = {
  placeholder: string;
  options: Record<string, string>;
  notesPlaceholder: string;
  update: string;
  saving: string;
};

const DEFAULT_LABELS: StaffStatusFormLabels = {
  placeholder: "Set status…",
  options: {
    checkin: "Checked in",
    out: "Checked out",
    sick: "Sick",
    vacation: "Vacation",
    absent: "Absent",
    child_sick: "Child sick",
  },
  notesPlaceholder: "Notes (optional)",
  update: "Update",
  saving: "Saving…",
};

const STATUS_VALUES = ["checkin", "out", "sick", "vacation", "absent", "child_sick"];

// Staff presence card control. Uses the staff check-in flow path so the
// before-opening guard returns a clear error here too.
export function StaffStatusForm({
  staffId,
  current,
  labels = DEFAULT_LABELS,
}: {
  staffId: string;
  current?: string;
  labels?: StaffStatusFormLabels;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <form
        className="row"
        style={{ gap: 8, alignItems: "center" }}
        action={(fd) =>
          start(async () => {
            setError(null);
            const res = await logStaffStatusAction(fd);
            if (res?.error) {
              setError(res.error);
              return;
            }
          })
        }
      >
        <input type="hidden" name="staffId" value={staffId} />
        <select className="select" name="kind" defaultValue={current ?? ""} style={{ maxWidth: 160 }}>
          <option value="">{labels.placeholder}</option>
          {STATUS_VALUES.map((v) => (
            <option key={v} value={v}>
              {labels.options[v] ?? v}
            </option>
          ))}
        </select>
        <input className="input" name="note" placeholder={labels.notesPlaceholder} style={{ maxWidth: 220 }} />
        <button className="btn btn-primary small" type="submit" disabled={pending}>
          {pending ? labels.saving : labels.update}
        </button>
      </form>
      {error && (
        <p className="small" style={{ color: "#dc2626", marginTop: 6, fontWeight: 600 }}>
          {error}
        </p>
      )}
    </div>
  );
}
