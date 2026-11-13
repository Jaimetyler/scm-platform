export function sslBillsChassisDirectly(terminal: string, steamshipLine?: string | null) {
  return terminal === "DAL" && ["MSC", "MEDITERRANEAN SHIPPING COMPANY"].includes(
    (steamshipLine ?? "").trim().replace(/\s+/g, " ").toUpperCase(),
  );
}
