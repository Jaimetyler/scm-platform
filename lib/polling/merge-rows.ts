// A read that started before an edit/save must not roll that edit back. Missing
// rows are retained only while protected or changed locally during this read.
export function mergePollingRows<T extends { id: string; updated_at: string }>(
  previous: T[], incoming: T[], atRequestStart: T[], protectedIds: Set<string>,
): T[] {
  const current = new Map(previous.map((row) => [row.id, row]));
  const started = new Map(atRequestStart.map((row) => [row.id, row]));
  const received = new Set(incoming.map((row) => row.id));
  const result: T[] = [];
  for (const row of incoming) {
    const local = current.get(row.id);
    if (!local && started.has(row.id)) continue; // Deleted locally during the read.
    result.push(local && (protectedIds.has(row.id) || local.updated_at > row.updated_at) ? local : row);
  }
  for (const row of previous) {
    if (received.has(row.id)) continue;
    const original = started.get(row.id);
    if (protectedIds.has(row.id) || row.id.startsWith("local-") || !original || row.updated_at > original.updated_at) result.push(row);
  }
  return result;
}
