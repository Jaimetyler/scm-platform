export const TRUCKING_SEGMENTS = [
  { code: 'MAIN', prefix: 'otr', label: 'MAIN · OTR', group: 'otr' },
  { code: 'TERRY', prefix: 'terry', label: 'TERRY · OTR', group: 'otr' },
  { code: 'DAVIS', prefix: 'davis', label: 'DAVIS · OTR', group: 'otr' },
  { code: 'CNTR', prefix: 'cntr', label: 'CNTR · Direct drays', group: 'drays' },
  { code: 'DDRAY', prefix: 'ddray', label: 'DDRAY · Drays', group: 'drays' },
] as const;
export function truckingSegments(metrics: Record<string, number>) {
  return TRUCKING_SEGMENTS.map(segment => {
    const revenue = metrics[segment.prefix + 'Revenue'] || 0;
    const pay = metrics[segment.prefix + 'Pay'] || 0;
    return { ...segment, loads: metrics[segment.prefix + 'Loads'] || 0,
      revenue, pay, gp: revenue - pay, margin: revenue ? (revenue - pay) / revenue : null };
  });
}
export function truckingGroupTotals(metrics: Record<string, number>) {
  const rows = truckingSegments(metrics);
  return (['otr', 'drays'] as const).map(group => {
    const selected = rows.filter(row => row.group === group);
    const revenue = selected.reduce((n, row) => n + row.revenue, 0);
    const pay = selected.reduce((n, row) => n + row.pay, 0);
    return { group, label: group === 'otr' ? 'Total OTR trucking' : 'Total drays',
      loads: selected.reduce((n, row) => n + row.loads, 0), revenue, pay,
      gp: revenue - pay, margin: revenue ? (revenue - pay) / revenue : null };
  });
}
