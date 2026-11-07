export function bookingReturnLocation(value: unknown) {
  if (value != null && typeof value !== "string") throw Error("Enter a return location.");
  const raw = String(value ?? "").trim().replace(/\s+/g, " ");
  if (raw.length > 300) throw Error("Return location must be 300 characters or fewer.");
  const key = raw.toUpperCase().replace(/[.,()]/g, "").replace(/\s+/g, " ");
  let code: string | null = null;
  if (["BNSFHATX", "DALLAS BNSF", "BNSF HASLET", "DALLAS RAMP BNSF HASLET", "BNSF ALLIANCE"].includes(key)) code = "BNSFHATX";
  if (["UNIOWITX", "UP WILMER", "UPRR WILMER", "UNION PACIFIC WILMER", "DIT", "UP DIT", "UP DALLAS INTERMODAL TERMINAL", "DALLAS INTERMODAL TERMINAL", "DALLAS INTERMODAL TERMINAL DIT"].includes(key) ||
    /^3701 (?:S|SOUTH) (?:INTERSTATE ?45|I[ -]?45)(?: |$)/.test(key)) code = "UNIOWITX";
  return { return_location: raw || null, return_location_code: code };
}
