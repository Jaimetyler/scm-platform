export const TRUCKING_SEGMENTS = [
  { code: 'MAIN', prefix: 'otr', label: 'MAIN · OTR' },
  { code: 'CNTR', prefix: 'cntr', label: 'CNTR · Direct drays' },
  { code: 'DAVIS', prefix: 'davis', label: 'DAVIS · Trucking' },
  { code: 'DDRAY', prefix: 'ddray', label: 'DDRAY · Drays' },
] as const;
export function truckingSegments(metrics: Record<string, number>) {
  return TRUCKING_SEGMENTS.map(segment => {
    const revenue = metrics[segment.prefix + 'Revenue'] || 0;
    const pay = metrics[segment.prefix + 'Pay'] || 0;
    return { ...segment, loads: metrics[segment.prefix + 'Loads'] || 0,
      revenue, pay, gp: revenue - pay, margin: revenue ? (revenue - pay) / revenue : null };
  });
}
