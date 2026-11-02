export type CottonLocation = {
  id: string;
  mcleod_code: string;
  prev_code: string | null;
  name: string;
  timezone: string | null;
  active: boolean;
};

export class CottonLocationResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CottonLocationResolutionError";
  }
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Resolve a report location against the approved location master.
 * Exact current codes take precedence over legacy codes. Ambiguous,
 * inactive and unknown locations must be reviewed before order creation.
 */
export function resolveCottonLocation(
  code: string,
  locations: readonly CottonLocation[],
): CottonLocation {
  const key = normalize(code);
  if (!key) throw new CottonLocationResolutionError("Missing location code.");
  const current = locations.filter((location) => normalize(location.mcleod_code) === key);
  const candidates = current.length
    ? current
    : locations.filter((location) => normalize(location.prev_code) === key);
  if (candidates.length !== 1)
    throw new CottonLocationResolutionError(
      candidates.length ? `Ambiguous location code: ${key}` : `Unknown location code: ${key}`,
    );
  const location = candidates[0];
  if (!location.active)
    throw new CottonLocationResolutionError(`Inactive location: ${key}`);
  if (!location.timezone)
    throw new CottonLocationResolutionError(`Missing timezone for location: ${key}`);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: location.timezone });
  } catch {
    throw new CottonLocationResolutionError(`Invalid timezone for location: ${key}`);
  }
  return location;
}
