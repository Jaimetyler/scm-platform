export function bookingReturnLocation(value: unknown) {
  if (value != null && typeof value !== "string") throw Error("Enter a return location.");
  const raw = String(value ?? "").trim().replace(/\s+/g, " ");
  if (raw.length > 300) throw Error("Return location must be 300 characters or fewer.");
  const key = raw.toUpperCase().replace(/[.,()]/g, "").replace(/\s+/g, " ");
  let code: string | null = null;
  if (["BNSFHATX", "DALLAS BNSF", "BNSF HASLET", "DALLAS RAMP BNSF HASLET", "BNSF ALLIANCE"].includes(key)) code = "BNSFHATX";
  if (["UNIOWITX", "UP WILMER", "UPRR WILMER", "UNION PACIFIC WILMER", "DIT", "UP DIT", "DALLAS UP - DIT", "DALLAS UP-DIT", "DALLAS UP DIT", "UP DALLAS INTERMODAL TERMINAL", "DALLAS INTERMODAL TERMINAL", "DALLAS INTERMODAL TERMINAL DIT"].includes(key) ||
    /^3701 (?:S|SOUTH) (?:INTERSTATE ?45|I[ -]?45)(?: |$)/.test(key)) code = "UNIOWITX";
  return { return_location: raw || null, return_location_code: code };
}

export function bookingReturnLocationLabel(location?: string | null, code?: string | null) {
  // Older bookings may have only the original address and no saved location code.
  const savedCode = code?.trim().toUpperCase();
  const resolvedCode = savedCode === "UNIOWITX" || savedCode === "BNSFHATX" ? savedCode
    : bookingReturnLocation(location).return_location_code;
  if (resolvedCode === "UNIOWITX") return "UP Wilmer";
  if (resolvedCode === "BNSFHATX") return "BNSF Haslet";
  return location || "Not set";
}

function returnKey(value?: string | null) {
  return value ? bookingReturnLocation(value).return_location_code ?? value.trim().replace(/\s+/g, " ").toUpperCase() : "";
}

export function carrierRateMatchesReturn(lane: string, location?: string | null, code?: string | null) {
  const target = returnKey(code) || returnKey(location);
  return Boolean(target && returnKey(lane) === target);
}

export function carrierRatesForReturn<T extends { lane: string; carrier_id: string; carrier_name?: string; updated_at: string }>(
  rates: T[], location?: string | null, code?: string | null,
) {
  const matches = new Map<string, T>();
  for (const rate of rates) {
    if (!carrierRateMatchesReturn(rate.lane, location, code)) continue;
    const key = JSON.stringify([rate.carrier_id.trim().toUpperCase(), rate.carrier_name?.trim().toLowerCase() ?? ""]);
    const saved = matches.get(key);
    if (!saved || rate.updated_at > saved.updated_at) matches.set(key, rate);
  }
  return [...matches.values()];
}
