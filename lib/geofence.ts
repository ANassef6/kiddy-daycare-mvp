// KID-2503: premises geofence for check-in/out.
//
// Pure module (no DB / no request imports) so the distance math and the
// accept/reject decision are unit-testable and shared by the web actions, the
// mobile API route and the settings validation. The server is the only place
// that decides whether a request is inside the radius; a client coordinate is
// never trusted beyond being an input to this calculation.
//
// The feature is off when the center has no stored premises coordinates
// (either field blank/invalid). The radius is one of three presets; anything
// else falls back to the 150 m default.

export const GEOFENCE_RADII = [150, 300, 600] as const;
export type GeofenceRadius = (typeof GEOFENCE_RADII)[number];
export const DEFAULT_GEOFENCE_RADIUS_M: GeofenceRadius = 150;

export type GeofenceConfig = {
  lat: number;
  lng: number;
  radiusM: GeofenceRadius;
};

export type GeofencePoint = {
  lat: number;
  lng: number;
  accuracyM: number | null;
};

export type GeofenceRefusal = {
  ok: false;
  code: "missing" | "malformed" | "outside";
  distanceM?: number;
  radiusM?: number;
};

export type GeofenceDecision =
  | ({ ok: true; override: boolean } & Partial<GeofencePoint>)
  | GeofenceRefusal;

export function isGeofenceRadius(value: unknown): value is GeofenceRadius {
  const n = Number(value);
  return (GEOFENCE_RADII as readonly number[]).includes(n);
}

export function normalizeGeofenceRadius(value: unknown): GeofenceRadius {
  return isGeofenceRadius(value) ? (Number(value) as GeofenceRadius) : DEFAULT_GEOFENCE_RADIUS_M;
}

/** Latitude must be a finite decimal in [-90, 90]; blank means "not set". */
export function parseLatitude(raw: unknown): number | null | undefined {
  return parseCoordinate(raw, 90);
}

/** Longitude must be a finite decimal in [-180, 180]; blank means "not set". */
export function parseLongitude(raw: unknown): number | null | undefined {
  return parseCoordinate(raw, 180);
}

// `null` = a blank value (the caller treats it as absent), `undefined` = the
// value was present but is not a valid coordinate.
function parseCoordinate(raw: unknown, limit: number): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < -limit || n > limit) return undefined;
  return n;
}

function parseAccuracy(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The center's configured fence, or null when either coordinate is unset. */
export function geofenceFromInstitute(inst: Record<string, unknown> | undefined | null): GeofenceConfig | null {
  const lat = parseLatitude(inst?.premises_lat);
  const lng = parseLongitude(inst?.premises_lng);
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  return {
    lat,
    lng,
    radiusM: normalizeGeofenceRadius(inst?.geofence_radius_m),
  };
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in metres. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Decide whether a check-in/out request passes the fence.
 *
 * - No configured fence → allowed (behavior unchanged), coordinates stored if
 *   the request happened to carry a valid pair.
 * - Admin override → allowed without requiring coordinates; valid coordinates
 *   are still kept for audit.
 * - Fence configured → blank coordinates are `missing`, unparseable ones are
 *   `malformed`, and a distance greater than the radius is `outside`.
 */
export function evaluateGeofence(
  config: GeofenceConfig | null,
  input: { lat?: unknown; lng?: unknown; accuracy?: unknown },
  options: { override?: boolean } = {}
): GeofenceDecision {
  const lat = parseLatitude(input.lat);
  const lng = parseLongitude(input.lng);
  const hasValidPoint = typeof lat === "number" && typeof lng === "number";

  if (options.override) {
    return {
      ok: true,
      override: true,
      ...(hasValidPoint ? { lat, lng, accuracyM: parseAccuracy(input.accuracy) } : {}),
    };
  }

  if (!config) {
    return {
      ok: true,
      override: false,
      ...(hasValidPoint ? { lat, lng, accuracyM: parseAccuracy(input.accuracy) } : {}),
    };
  }

  if (lat === null || lng === null) {
    return { ok: false, code: "missing" };
  }
  if (lat === undefined || lng === undefined) {
    return { ok: false, code: "malformed" };
  }

  const distanceM = haversineMeters(config.lat, config.lng, lat, lng);
  if (distanceM > config.radiusM) {
    return {
      ok: false,
      code: "outside",
      distanceM: Math.round(distanceM),
      radiusM: config.radiusM,
    };
  }

  return {
    ok: true,
    override: false,
    lat,
    lng,
    accuracyM: parseAccuracy(input.accuracy),
  };
}
