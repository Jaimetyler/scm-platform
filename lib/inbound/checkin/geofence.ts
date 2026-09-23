export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type GateLocationCheck = {
  gate: Coordinates & { radiusMeters: number };
  driver: Coordinates & { accuracyMeters: number; capturedAt: string };
  now?: Date;
};

const EARTH_RADIUS_METERS = 6_371_000;
export const MAX_DRIVER_LOCATION_AGE_MS = 5 * 60 * 1000;
export const MAX_DRIVER_LOCATION_ACCURACY_METERS = 250;

function toRadians(value: number) {
  return value * Math.PI / 180;
}

export function isValidLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function distanceInMeters(a: Coordinates, b: Coordinates) {
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const aLatitude = toRadians(a.latitude);
  const bLatitude = toRadians(b.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(aLatitude) * Math.cos(bLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function verifyGateLocation(input: GateLocationCheck) {
  const now = input.now ?? new Date();
  const capturedAt = new Date(input.driver.capturedAt);
  const ageMs = now.getTime() - capturedAt.getTime();

  if (!isValidLatitude(input.driver.latitude) || !isValidLongitude(input.driver.longitude)) {
    return { ok: false as const, error: "Your phone returned an invalid location." };
  }
  if (!Number.isFinite(capturedAt.getTime()) || ageMs < -60_000 || ageMs > MAX_DRIVER_LOCATION_AGE_MS) {
    return { ok: false as const, error: "Your location expired. Please try checking in again." };
  }
  if (!Number.isFinite(input.driver.accuracyMeters) || input.driver.accuracyMeters < 0 ||
      input.driver.accuracyMeters > MAX_DRIVER_LOCATION_ACCURACY_METERS) {
    return { ok: false as const, error: "Your GPS signal is not accurate enough. Move into an open area and try again." };
  }
  if (!isValidLatitude(input.gate.latitude) || !isValidLongitude(input.gate.longitude) ||
      !Number.isFinite(input.gate.radiusMeters) || input.gate.radiusMeters < 25) {
    return { ok: false as const, error: "This gate location is not configured correctly." };
  }

  const distanceMeters = distanceInMeters(input.gate, input.driver);
  // Accuracy is the phone's estimated error radius. Subtract it so a driver
  // whose accuracy circle overlaps the geofence is not rejected at the gate.
  const minimumPossibleDistance = Math.max(0, distanceMeters - input.driver.accuracyMeters);
  if (minimumPossibleDistance > input.gate.radiusMeters) {
    return {
      ok: false as const,
      error: "You must be at the SCM yard to check in.",
      distanceMeters,
    };
  }

  return { ok: true as const, distanceMeters };
}

export function warehouseDate(instant: Date, terminal: "SAV" | "HOU") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: terminal === "HOU" ? "America/Chicago" : "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
