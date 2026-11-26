"use client";

import { useTransition, useState } from "react";
import { checkInOutAction } from "@/lib/actions";
import type { Dict } from "@/lib/i18n";
import { tr } from "@/lib/i18n";
import { GeolocationNotice } from "@/components/GeolocationNotice";
import { useGeolocation } from "@/components/useGeolocation";

export function CheckInButton({
  childId,
  checkedIn,
  dict,
  requireLocation = false,
}: {
  childId: string;
  checkedIn: boolean;
  dict: Dict;
  /** KID-2503: true when the center has a premises fence configured. */
  requireLocation?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const geo = useGeolocation(requireLocation, dict);
  return (
    <div>
      <button
        className={checkedIn ? "btn btn-accent btn-block" : "btn btn-primary btn-block"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const fd = new FormData();
            fd.set("childId", childId);
            fd.set("type", checkedIn ? "out" : "in");
            if (requireLocation) {
              const point = await geo.capture();
              if (!point) return;
              fd.set("lat", String(point.lat));
              fd.set("lng", String(point.lng));
              if (point.accuracy !== undefined) fd.set("accuracy", String(point.accuracy));
            }
            const res = (await checkInOutAction(fd)) as { error?: string } | undefined;
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending ? tr(dict, "common.saving") : checkedIn ? tr(dict, "attendees.checkOut") : tr(dict, "attendees.checkIn")}
      </button>
      <GeolocationNotice
        required={requireLocation}
        state={geo.state}
        hint={geo.hint}
        busy={geo.busy}
        onEnable={() => void geo.capture()}
        dict={dict}
      />
      {error && (
        <p className="small" style={{ color: "#dc2626", marginTop: 8, fontWeight: 600 }}>
          {error}
        </p>
      )}
    </div>
  );
}
