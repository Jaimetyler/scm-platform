function minute(value: unknown) {
  const raw = String(value ?? "");
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})$/);
  return Math.floor(Date.parse(compact ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}${compact[7]}` : raw) / 60000);
}

// McLeod rounds clearStop actuals to minutes and may return a different offset.
export function departureRepairVerified(before: Record<string, any>, after: Record<string, any>, stopId: string, departure: string) {
  if (["id", "revenue_code_id", "customer_id", "consignee_refno", "blnum"].some(field => after[field] !== before[field])) return false;
  const original = before.stops?.find((stop: Record<string, any>) => stop.id === stopId);
  const actual = after.stops?.find((stop: Record<string, any>) => stop.id === stopId);
  if (!original || !actual || actual.stop_type !== "SO" || actual.location_id !== original.location_id ||
      actual.actual_arrival !== original.actual_arrival || minute(actual.actual_departure) !== minute(departure)) return false;
  const movement = before.movements?.length === 1 ? before.movements[0] : null;
  const verifiedMovement = after.movements?.find((item: Record<string, any>) => item.id === movement?.id);
  if (!movement?.id || verifiedMovement?.brokerage_status !== "FINISHED" || verifiedMovement.status !== "D" || after.status !== "D") return false;
  const pickups = before.stops?.filter((stop: Record<string, any>) => stop.stop_type === "PU") ?? [];
  return pickups.length === 1 && pickups.every((pickup: Record<string, any>) => {
    const checked = after.stops?.find((stop: Record<string, any>) => stop.id === pickup.id);
    return checked && checked.actual_arrival === pickup.actual_arrival && checked.actual_departure === pickup.actual_departure;
  });
}
