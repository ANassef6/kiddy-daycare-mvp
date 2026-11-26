// KID-2503: browser geolocation wrapper shared by the check-in controls and
// the "Use my current location" helper in center settings. Kept separate from
// the React hook so it can be called from a plain event handler.
export type BrowserGeoPoint = {
  lat: number;
  lng: number;
  accuracy?: number;
};

export type BrowserGeoFailure = "unsupported" | "denied" | "unavailable";

export type BrowserGeoResult =
  | { ok: true; point: BrowserGeoPoint }
  | { ok: false; reason: BrowserGeoFailure };

export function browserGeolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export function getBrowserPosition(timeoutMs = 10_000): Promise<BrowserGeoResult> {
  if (!browserGeolocationSupported()) {
    return Promise.resolve({ ok: false, reason: "unsupported" });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const accuracy = Number(pos.coords.accuracy);
        resolve({
          ok: true,
          point: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            ...(Number.isFinite(accuracy) ? { accuracy } : {}),
          },
        });
      },
      (err) => {
        resolve({
          ok: false,
          reason: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
        });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}
