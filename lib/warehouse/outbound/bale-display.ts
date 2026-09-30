export function bookingBaleDisplay(line: {
  available_bales: number; inbound_bales: number; requested_bales: number; mark_requested_total?: number;
}) {
  const expected = line.mark_requested_total ?? line.requested_bales;
  const received = line.available_bales > 0 ? line.available_bales : line.inbound_bales;
  const matches = received === expected;
  return { text: matches ? String(received) : `${received} of ${expected}`,
    color: matches ? "#4ade80" : "#f87171",
    title: `${line.available_bales > 0 ? "In warehouse" : line.inbound_bales > 0 ? "Reported in delivery line; receiving pending" : "Not received"} · ${received} bales · ${expected} requested for this mark` };
}
