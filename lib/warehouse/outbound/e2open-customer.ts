export function isSavannahE2openBooking(terminal: string, customer: string) {
  return terminal === "SAV" && /^(?:LOUIS DRE?YFUS(?: COMPANY)?(?: COTTON)?|LDCACOTN)$/.test(
    customer.trim().replace(/\s+/g, " ").toUpperCase(),
  );
}
