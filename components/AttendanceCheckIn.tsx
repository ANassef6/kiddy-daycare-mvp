"use client";

import { useTransition, useState } from "react";
import { checkInOutAction } from "@/lib/actions";
import { en, type Dict } from "@/lib/i18n";
import { GeolocationNotice } from "@/components/GeolocationNotice";
import { useGeolocation } from "@/components/useGeolocation";

// Per-row check-in/out control for the attendance page. Runs the same server
// action the parent app uses so the "not open yet" guard surfaces the error
// inline instead of silently failing.
export function AttendanceCheckIn({
  childId,
  lastEvent,
  labels = { checkIn: "Check in", checkOut: "Check out", saving: "Saving…" },
  requireLocation = false,
  dict = en,
}: {
  childId: string;
  lastEvent?: string;
  labels: { checkIn: string; checkOut: string; saving: string };
  /** KID-2503: admins bypass the premises fence on this management surface. */
  requireLocation?: boolean;
  dict?: Dict;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const geo = useGeolocation(requireLocation, dict);
  const checkedIn = lastEvent === "in";
  return (
    <div>
      <form
        action={(fd) =>
          start(async () => {
            setError(null);
            if (requireLocation) {
              const point = await geo.capture();
              if (!point) return;
              fd.set("lat", String(point.lat));
              fd.set("lng", String(point.lng));
              if (point.accuracy !== undefined) fd.set("accuracy", String(point.accuracy));
            }
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
      <GeolocationNotice
        required={requireLocation}
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
