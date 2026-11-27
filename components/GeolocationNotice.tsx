"use client";

import { en, tr, type Dict } from "@/lib/i18n";
import type { GeolocationState } from "@/components/useGeolocation";

// KID-2503: the explicit "Enable location access" control shown next to a
// check-in/out button when the browser permission is missing. Mirrors the
// notification-permission card: a blocked or unsupported browser gets an
// instruction, never a silent failure.
export function GeolocationNotice({
  required,
  state,
  hint,
  busy,
  onEnable,
  dict = en,
}: {
  required: boolean;
  state: GeolocationState;
  hint: string | null;
  busy: boolean;
  onEnable: () => void;
  dict?: Dict;
}) {
  if (!required) return null;
  if (state === "denied") {
    return (
      <p className="small" role="alert" style={{ color: "#b45309", marginTop: 6 }}>
        {tr(dict, "geofence.denied")}
      </p>
    );
  }
  if (state === "unsupported") {
    return (
      <p className="small" role="alert" style={{ color: "#b45309", marginTop: 6 }}>
        {tr(dict, "geofence.unsupported")}
      </p>
    );
  }
  return (
    <div className="mt-2">
      {(state === "prompt" || state === "checking") && (
        <button type="button" className="btn btn-ghost small" disabled={busy} onClick={onEnable}>
          {busy ? tr(dict, "geofence.locating") : tr(dict, "geofence.enableLocation")}
        </button>
      )}
      {hint && (
        <p className="small" role="alert" style={{ color: "#b45309", marginTop: 6 }}>
          {hint}
        </p>
      )}
    </div>
  );
}
