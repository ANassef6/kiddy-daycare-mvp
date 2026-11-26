"use client";

import { useTransition, useState } from "react";
import { logStaffStatusAction } from "@/lib/actions";
import { en, type Dict } from "@/lib/i18n";
import { GeolocationNotice } from "@/components/GeolocationNotice";
import { useGeolocation } from "@/components/useGeolocation";

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
  requireLocation = false,
  dict = en,
}: {
  staffId: string;
  current?: string;
  labels?: StaffStatusFormLabels;
  /** KID-2503: true when this card is the staff member's own fenced
   *  check-in/out (admins setting another staff member bypass the fence). */
  requireLocation?: boolean;
  dict?: Dict;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState(current ?? "");
  const geo = useGeolocation(requireLocation, dict);
  const needsFence = requireLocation && (kind === "checkin" || kind === "out");
  return (
    <div>
      <form
        className="row"
        style={{ gap: 8, alignItems: "center" }}
        action={(fd) =>
          start(async () => {
            setError(null);
            if (needsFence) {
              const point = await geo.capture();
              if (!point) return;
              fd.set("lat", String(point.lat));
              fd.set("lng", String(point.lng));
              if (point.accuracy !== undefined) fd.set("accuracy", String(point.accuracy));
            }
            const res = await logStaffStatusAction(fd);
            if (res?.error) {
              setError(res.error);
              return;
            }
          })
        }
      >
        <input type="hidden" name="staffId" value={staffId} />
        <select
          className="select"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          style={{ maxWidth: 160 }}
        >
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
      <GeolocationNotice
        required={needsFence}
        state={geo.state}
        hint={geo.hint}
        busy={geo.busy}
        onEnable={() => void geo.capture()}
        dict={dict}
      />
      {error && (
        <p className="small" style={{ color: "#dc2626", marginTop: 6, fontWeight: 600 }}>
          {error}
        </p>
      )}
    </div>
  );
}
