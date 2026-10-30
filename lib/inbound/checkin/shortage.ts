export type ShortageFields = {
  movement_direction?: string | null;
  material_type?: string | null;
  bol_bc?: number | null;
  bale_count?: number | null;
  expected_bale_count?: number | null;
  driver_reported_bales?: number | null;
  shortage_acknowledged_at?: string | null;
  shortage_acknowledged_by?: string | null;
  shortage_expected_bales?: number | null;
  shortage_received_bales?: number | null;
  shortage_note?: string | null;
  customer_notified_at?: string | null;
  customer_notified_by?: string | null;
};

export function cottonShortage(row: ShortageFields) {
  if ((row.movement_direction ?? "delivery") !== "delivery" ||
      (row.material_type ?? "cotton") !== "cotton") return null;
  const expected = row.expected_bale_count ?? row.bol_bc;
  const received = row.bale_count ?? row.driver_reported_bales ??
    (row.expected_bale_count ? row.bol_bc : null);
  if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(received) ||
      expected! <= 0 || received! < 0 || received! >= expected!) return null;
  return { expected: expected!, received: received!, missing: expected! - received! };
}

export function shortageAcknowledged(row: ShortageFields) {
  const shortage = cottonShortage(row);
  return Boolean(shortage && row.shortage_acknowledged_at && row.shortage_note?.trim() &&
    row.shortage_expected_bales === shortage.expected && row.shortage_received_bales === shortage.received);
}

export function acknowledgeShortage(row: ShortageFields, note: unknown, actor: string, at: string) {
  const shortage = cottonShortage(row);
  const text = String(note ?? "").trim();
  if (!shortage) throw new Error("This load does not have a bale shortage");
  if (!text || text.length > 2000) throw new Error("Enter a shortage note (up to 2,000 characters)");
  return { shortage_acknowledged_at: at, shortage_acknowledged_by: actor,
    shortage_expected_bales: shortage.expected, shortage_received_bales: shortage.received,
    shortage_note: text, customer_notified_at: null, customer_notified_by: null };
}

export function checkinActor(authorization: string | null) {
  try { return atob(authorization?.slice(6) ?? "").split(":")[0] || "warehouse staff"; }
  catch { return "warehouse staff"; }
}
