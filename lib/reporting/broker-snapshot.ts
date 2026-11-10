export type Row = {
  month: string;
  code: string;
  person: string;
  customer: string;
  name: string;
  loads: number;
  revenue: number;
  pay: number;
  margin: number;
};

export type Snapshot = {
  version: number;
  rows: Row[];
};

export const MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;

export function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;

  const data = value as Snapshot;

  return (
    data.version === 1 &&
    Array.isArray(data.rows) &&
    data.rows.length > 0 &&
    data.rows.every(
      (row) =>
        row &&
        typeof row === "object" &&
        [row.code, row.person, row.customer, row.name].every(
          (field) => typeof field === "string",
        ) &&
        typeof row.month === "string" &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month) &&
        [row.loads, row.revenue, row.pay, row.margin].every((field) =>
          Number.isSafeInteger(field),
        ) &&
        row.loads >= 0,
    )
  );
}

