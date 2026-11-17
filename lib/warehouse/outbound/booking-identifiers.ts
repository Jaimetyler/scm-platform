export function outboundBookingNumber(value: unknown) {
  return String(value ?? "").trim().toUpperCase().split(/\s+/)[0].replace(/-(?:HOU|DAL|SAV)$/, "");
}

export function outboundSteamshipLine(value: unknown, bookingNumber?: string) {
  const name = String(value ?? "").trim();
  const key = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (key === "MSC" || key.startsWith("MEDITERRANEANSHIPPINGCOMPANY")) return "MSC";
  if (key === "ONE" || /^OCEANNETWOR[DK]EXPRESS/.test(key)) return "ONE";
  if (["HHM", "HMM", "HYUNDAI", "HYNDAI"].includes(key) || /^(?:HYUNDAI|HYNDAI)MERCHANTMARINE/.test(key)) return "HHM";
  if (key === "CMA" || key.startsWith("CMACGM")) return "CMA";
  if (name) return name;

  const booking = outboundBookingNumber(bookingNumber);
  if (/^EBKG\d+$/.test(booking)) return "MSC";
  if (/^RIC[A-Z0-9]+\d$/.test(booking)) return "ONE";
  if (/^NAM\d+$/.test(booking)) return "CMA";
  return "";
}
