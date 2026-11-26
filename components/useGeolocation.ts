"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { en, tr, type Dict } from "@/lib/i18n";
import {
  browserGeolocationSupported,
  getBrowserPosition,
  type BrowserGeoPoint,
} from "@/lib/geolocation-client";

export type GeolocationState = "checking" | "granted" | "prompt" | "denied" | "unsupported";

// KID-2503: shared client state for the check-in/out location gate. It does
// not decide the fence — the server does — it only captures a position and
// guides the user through the browser permission. A recent position is reused
// for a few seconds so pressing "Enable location access" and then submitting
// does not trigger a second OS prompt.
const POINT_TTL_MS = 30_000;

export function useGeolocation(required: boolean, dict: Dict = en) {
  const [state, setState] = useState<GeolocationState>(required ? "checking" : "granted");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pointRef = useRef<{ point: BrowserGeoPoint; at: number } | null>(null);

  useEffect(() => {
    if (!required) return;
    if (!browserGeolocationSupported()) {
      setState("unsupported");
      return;
    }
    let cancelled = false;
    let permission: PermissionStatus | null = null;
    let onChange: (() => void) | null = null;
    const apply = (value: PermissionState) => {
      if (cancelled) return;
      setState(value === "granted" ? "granted" : value === "denied" ? "denied" : "prompt");
    };
    const geolocation = navigator.permissions;
    if (!geolocation?.query) {
      setState("prompt");
      return;
    }
    geolocation
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        permission = result;
        apply(result.state);
        onChange = () => apply(result.state);
        result.addEventListener?.("change", onChange);
      })
      .catch(() => {
        if (!cancelled) setState("prompt");
      });
    return () => {
      cancelled = true;
      if (permission && onChange) permission.removeEventListener?.("change", onChange);
    };
  }, [required]);

  const capture = useCallback(async (): Promise<BrowserGeoPoint | null> => {
    if (!required) return null;
    const cached = pointRef.current;
    if (cached && Date.now() - cached.at < POINT_TTL_MS) return cached.point;

    setBusy(true);
    setHint(null);
    try {
      const result = await getBrowserPosition();
      if (result.ok) {
        pointRef.current = { point: result.point, at: Date.now() };
        setState("granted");
        return result.point;
      }
      if (result.reason === "denied") {
        setState("denied");
        setHint(tr(dict, "geofence.denied"));
      } else if (result.reason === "unsupported") {
        setState("unsupported");
        setHint(tr(dict, "geofence.unsupported"));
      } else {
        setHint(tr(dict, "geofence.unavailable"));
      }
      return null;
    } finally {
      setBusy(false);
    }
  }, [dict, required]);

  return { state, hint, busy, capture };
}
