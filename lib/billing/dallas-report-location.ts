/** Exact report headings confirmed by operations; never infer location from references. */
export function dallasReportLocation(csvText: string): string | null {
  const heading = csvText.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0].split(",", 1)[0].replace(/^"|"$/g, "").trim();
  if (/^Supply Chain - Dallas 2 \(843001\)$/i.test(heading)) return "SCMDDATX";
  if (/^Supply Chain Management Dallas \(875260\)$/i.test(heading)) return "SCMDDETX";
  return null;
}
