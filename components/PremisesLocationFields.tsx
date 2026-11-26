"use client";

import { useState } from "react";
import { GEOFENCE_RADII } from "@/lib/geofence";
import { getBrowserPosition } from "@/lib/geolocation-client";
import { tr, type Dict } from "@/lib/i18n";

// KID-2503: premises coordinates + radius inside the center-details form.
// The "Use my current location" helper only fills the fields — the server
// still validates the stored values, and the fence itself always runs
// server-side.
export function PremisesLocationFields({
  lat,
  lng,
  radius,
  dict,
}: {
  lat: string;
  lng: string;
  radius: number;
  dict: Dict;
}) {
  const [latValue, setLatValue] = useState(lat);
  const [lngValue, setLngValue] = useState(lng);
  const [radiusValue, setRadiusValue] = useState(String(radius));
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fillFromCurrentLocation = async () => {
    setBusy(true);
    setHint(null);
    try {
      const result = await getBrowserPosition();
      if (result.ok) {
        setLatValue(result.point.lat.toFixed(6));
        setLngValue(result.point.lng.toFixed(6));
        setHint(tr(dict, "geofence.captured"));
        return;
      }
      setHint(
        tr(
          dict,
          result.reason === "denied"
            ? "geofence.denied"
            : result.reason === "unsupported"
              ? "geofence.unsupported"
              : "geofence.unavailable"
        )
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row">
        <div className="col field">
          <label className="label" htmlFor="premises-lat">
            {tr(dict, "settings.premisesLat")}
          </label>
          <input
            className="input"
            id="premises-lat"
            name="premisesLat"
            type="number"
            step="any"
            min={-90}
            max={90}
            inputMode="decimal"
            autoComplete="off"
            value={latValue}
            onChange={(e) => setLatValue(e.target.value)}
            placeholder={tr(dict, "settings.premisesLatPlaceholder")}
          />
        </div>
        <div className="col field">
          <label className="label" htmlFor="premises-lng">
            {tr(dict, "settings.premisesLng")}
          </label>
          <input
            className="input"
            id="premises-lng"
            name="premisesLng"
            type="number"
            step="any"
            min={-180}
            max={180}
            inputMode="decimal"
            autoComplete="off"
            value={lngValue}
            onChange={(e) => setLngValue(e.target.value)}
            placeholder={tr(dict, "settings.premisesLngPlaceholder")}
          />
        </div>
      </div>
      <div className="field">
        <button
          type="button"
          className="btn btn-ghost small"
          disabled={busy}
          onClick={() => void fillFromCurrentLocation()}
        >
          {busy ? tr(dict, "geofence.locating") : tr(dict, "geofence.useMyLocation")}
        </button>
        {hint && (
          <p className="small" role="alert" style={{ marginTop: 6 }}>
            {hint}
          </p>
        )}
      </div>
      <div className="field">
        <label className="label" htmlFor="geofence-radius">
          {tr(dict, "settings.premisesRadius")}
        </label>
        <select
          className="select"
          id="geofence-radius"
          name="geofenceRadius"
          value={radiusValue}
          onChange={(e) => setRadiusValue(e.target.value)}
        >
          {GEOFENCE_RADII.map((meters) => (
            <option key={meters} value={meters}>
              {tr(dict, "settings.geofenceRadiusOption", { meters })}
            </option>
          ))}
        </select>
        <p className="small muted">{tr(dict, "settings.geofenceRadiusHint")}</p>
      </div>
    </>
  );
}
