export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseBales(blnumRaw: string | null | undefined): number {
  const blnum = safeString(blnumRaw);
  if (!blnum) return 0;

  const patterns = [
    /(?:^|\s)(\d+)\s*BALES?\b/i,
    /\bB\/?C\s*(\d+)\b/i,
    /\b(\d+)\s*B\/?C\b/i,
    /\bBC\s*(\d+)\b/i,
    /\b(\d+)\s*BC\b/i,
  ];

  for (const pattern of patterns) {
    const match = blnum.match(pattern);

    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }

  return 0;
}

export function parseMark(blnumRaw: string | null | undefined): string | null {
  const blnum = safeString(blnumRaw);
  if (!blnum) return null;

  const first = blnum.split(/\s+/)[0]?.trim();
  return first ? first.toUpperCase() : null;
}

export function normalizeDateInput(
  value: string | null | undefined
): Date | null {
  if (!value) return null;

  const raw = value.trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  // McLeod compact datetime format:
  // 20260518000000-0400
  const mcleodMatch = raw.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})$/
  );

  if (mcleodMatch) {
    const year = Number(mcleodMatch[1]);
    const month = Number(mcleodMatch[2]) - 1;
    const day = Number(mcleodMatch[3]);
    const hour = Number(mcleodMatch[4]);
    const minute = Number(mcleodMatch[5]);
    const second = Number(mcleodMatch[6]);

    const dt = new Date(year, month, day, hour, minute, second, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // Common manual/date-string format:
  // 05/18/2026 or 05/18/2026 3:30PM
  const slashMatch = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(AM|PM))?$/i
  );

  if (slashMatch) {
    const month = Number.parseInt(slashMatch[1], 10) - 1;
    const day = Number.parseInt(slashMatch[2], 10);
    const year = Number.parseInt(slashMatch[3], 10);

    let hour = 0;
    const minute = slashMatch[5] ? Number.parseInt(slashMatch[5], 10) : 0;
    const ampm = slashMatch[6]?.toUpperCase();

    if (slashMatch[4]) {
      hour = Number.parseInt(slashMatch[4], 10);
      if (ampm === "PM" && hour < 12) hour += 12;
      if (ampm === "AM" && hour === 12) hour = 0;
    }

    const dt = new Date(year, month, day, hour, minute, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

export function formatDateFromDate(dt: Date | null): string | null {
  if (!dt) return null;

  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

export function formatDateOnly(value: string | null | undefined): string | null {
  return formatDateFromDate(normalizeDateInput(value));
}

export function addDays(date: Date | null, days: number): Date | null {
  if (!date) return null;

  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);

  return copy;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function diffDaysLate(anchor: Date | null, today = new Date()): number {
  if (!anchor) return 0;

  const a = startOfDay(anchor);
  const t = startOfDay(today);

  const ms = t.getTime() - a.getTime();
  const days = Math.floor(ms / 86_400_000);

  return days > 0 ? days : 0;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}