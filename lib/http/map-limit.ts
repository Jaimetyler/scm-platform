/** Preserve result order while bounding per-request external fan-out. */
export async function mapLimit<T, R>(items: T[], concurrency: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, Math.floor(concurrency))) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await run(items[index], index); }
  }));
  return result;
}
