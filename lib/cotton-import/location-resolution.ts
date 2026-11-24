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
  return location;
}

/** Prefer the dispatch code, and use a known warehouse name to catch mismatches. */
export function resolveCottonWarehouseName(
  warehouseName: string,
  locations: readonly CottonLocation[],
  warehouseCode?: string | null,
): CottonLocation {
  const byCode = warehouseCode ? resolveCottonLocation(warehouseCode, locations) : null;
  const name = normalize(warehouseName);
  if (!name && !byCode) throw new CottonLocationResolutionError("Missing warehouse name.");
  // Confirmed Bunge Houston dispatch aliases; resolve to the master rather than inventing locations.
  const houstonAliases: Record<string,string> = {
    "MOODY COMPRESS #01":"MOODGAT1",
    "MOODY COMPRESS AND WAREHOUSE #01":"MOODGAT1",
    "MOODY COMPRESS #1":"MOODGAT1",
    "MOODY COMPRESS AND WAREHOUSE #1":"MOODGAT1",
    "MOODY COMPRESS #03":"MOODGAT4",
    "MOODY COMPRESS AND WAREHOUSE #03":"MOODGAT4",
    "MOODY COMPRESS AND WAREHOUSE #04":"MOODGAT3",
    "MOODY COMPRESS #04":"MOODGAT3",
    "MOODY COMPRESS #3":"MOODGAT4",
    "MOODY COMPRESS #4":"MOODGAT3",
    "GULF COMPRESS #01":"GULFCOT2",
    "GULF COMPRESS #1":"GULFCOT2",
    "COTTON WAREHOUSE OF CONCORDIA":"CONCFELA",
    "TAYLOR COMPRESS":"TAYLTAT1",
    "UNITED AGRICULTURAL COOPERATIVE":"UNITELTX",
    "UNITED AGRICULTURAL COOPERATIVE, INC.":"UNITELTX",
    "UNITED AGRICULTURAL CO-OP":"UNITELTX",
  };
  const alias = Object.hasOwn(houstonAliases, name) ? houstonAliases[name] : undefined;
  const candidates = alias ? [] : locations.filter(location => normalize(location.name) === name);
  if (candidates.length > 1)
    throw new CottonLocationResolutionError(`Ambiguous warehouse name: ${name}`);

  const nameCode = alias ?? candidates[0]?.mcleod_code;
  if (byCode) {
    if (nameCode && normalize(nameCode) !== normalize(byCode.mcleod_code))
      throw new CottonLocationResolutionError("USDA warehouse code conflicts with dispatch warehouse name.");
    return byCode;
  }
  if (!nameCode)
    throw new CottonLocationResolutionError(`Unmapped warehouse name: ${name}`);
  return resolveCottonLocation(nameCode, locations);
}
