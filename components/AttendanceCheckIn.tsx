"use client";

import { useTransition, useState } from "react";
import { checkInOutAction } from "@/lib/actions";

// Per-row check-in/out control for the attendance page. Runs the same server
// action the parent app uses so the "not open yet" guard surfaces the error
// inline instead of silently failing.
export function AttendanceCheckIn({
  childId,
  lastEvent,
  labels = { checkIn: "Check in", checkOut: "Check out", saving: "Saving…" },
}: {
  childId: string;
  lastEvent?: string;
  labels: { checkIn: string; checkOut: string; saving: string };
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const checkedIn = lastEvent === "in";
  return (
    <div>
      <form
        action={(fd) =>
          start(async () => {
            setError(null);
            const res = await checkInOutAction(fd);
            if (res?.error) setError(res.error);
          })
        }
        className="row"
        style={{ gap: 6 }}
      >
        <input type="hidden" name="childId" value={childId} />
        <input type="hidden" name="type" value={checkedIn ? "out" : "in"} />
        <button
          className={checkedIn ? "btn btn-ghost small" : "btn btn-primary small"}
          type="submit"
          disabled={pending}
        >
          {pending ? labels.saving : checkedIn ? labels.checkOut : labels.checkIn}
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