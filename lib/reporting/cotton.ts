export type CottonMetrics = Record<string, number>;
export function cottonServices(metrics: CottonMetrics) {
  const value = (key: string) => metrics[key] || 0;
  return ['warehouse', 'otr', 'dray'].map(kind => ({
    kind,
    label: kind === 'warehouse' ? 'eCotton handling & storage' : kind === 'otr' ? 'Cotton OTR · MAIN / DAVIS' : 'Cotton drayage',
    orders: value(kind + 'Orders'),
    revenue: value(kind + 'Revenue'),
    pay: kind === 'warehouse' ? null : value(kind + 'Pay'),
    gp: kind === 'warehouse' ? null : value(kind + 'RevenueWithPay') - value(kind + 'Pay'),
    payMissing: kind === 'warehouse' ? 0 : value(kind + 'PayMissing'),
  }));
}
export function cottonTransportGP(metrics: CottonMetrics) {
  return cottonServices(metrics).reduce((n, row) => n + (row.gp ?? 0), 0);
}
export function cottonContribution(metrics: CottonMetrics) {
  return (metrics.warehouseRevenue || 0) + cottonTransportGP(metrics);
}
