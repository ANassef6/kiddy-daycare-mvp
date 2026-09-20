"use client";

import { useTransition, useState } from "react";
import { logStaffStatusAction } from "@/lib/actions";

const STAFF_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Set status…" },
  { value: "checkin", label: "Checked in" },
  { value: "sick", label: "Sick" },
  { value: "vacation", label: "Vacation" },
  { value: "absent", label: "Absent" },
  { value: "child_sick", label: "Child sick" },
];

// Staff presence card control. Uses the staff check-in flow path so the
// before-opening guard returns a clear error here too.
export function StaffStatusForm({ staffId, current }: { staffId: string; current?: string }) {
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
          {STAFF_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input className="input" name="note" placeholder="Notes (optional)" style={{ maxWidth: 220 }} />
        <button className="btn btn-primary small" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Update"}
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