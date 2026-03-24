export function normalizeKey(value: string | null | undefined) {
  return (value || "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeDateToShort(value: string | null | undefined) {
  if (!value) return null;

  const raw = String(value).trim();

  // Handle YYYY-MM-DD safely without timezone shifting
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return `${mm}/${dd}/${yyyy}`;
  }

  // Handle already-short-ish values like M/D/YYYY or MM/DD/YYYY
  const shortMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (shortMatch) {
    const [, m, d, yyyy] = shortMatch;
    return `${m.padStart(2, "0")}/${d.padStart(2, "0")}/${yyyy}`;
  }

  // Fallback for full datetime strings
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;

  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

export function parseBlnum(value: string | null | undefined) {
  const raw = (value || "").toUpperCase().trim().replace(/\s+/g, " ");
  const parts = raw ? raw.split(" ") : [];

  return {
    raw,
    mark: parts[0] || "",
    count: parts[1] || "",
    unit: parts.slice(2).join(" "),
  };
}