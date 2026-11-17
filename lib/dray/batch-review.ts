export async function runDrayBatch<T extends { rowId: string }>(
  rows: T[],
  attempt: (row: T) => Promise<string | undefined>,
) {
  const failures: Record<string, string> = {};
  for (const row of rows) {
    try {
      const issue = await attempt(row);
      if (issue) failures[row.rowId] = issue;
    } catch (error) {
      failures[row.rowId] = error instanceof Error ? error.message : "Could not verify this attempt. Review the saved row.";
    }
  }
  return failures;
}
