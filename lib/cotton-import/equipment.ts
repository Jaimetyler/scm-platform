type Pickup = { locationId: string; locationCode: string; scheduledDate: string };
export type PickupEquipmentPolicy = {
  location_id: string; accepted_equipment: string; effective_date: string | null; verified: boolean;
};

const confirmedVanOnly = new Set(["MOODGAT1", "MOODGAT2", "MOODGAT3", "MOODGAT4"]);
const confirmedFlexible = new Set([
  "GULFCOT1", "GULFCOT2", "GULFPOTX", "GULFRAT1", "GULFRAT6", "GULFRATX", "GULFSWTX",
  "TAYLTAT1", "TAYLBRTX", "TAYLTATX",
]);

export const equipmentOptions = ["auto", "van", "flatbed", "VT"] as const;
export type EquipmentOption = typeof equipmentOptions[number];
const mcleodEquipmentCodes = { van: "V", flatbed: "FT", VT: "VT" } as const;
export type McLeodCottonEquipmentCode = typeof mcleodEquipmentCodes[keyof typeof mcleodEquipmentCodes];

export function requestedEquipment(value: unknown): EquipmentOption {
  if (value == null) return "auto";
  const option = equipmentOptions.find(candidate => candidate === value);
  if (!option) throw new Error("Choose automatic, van, flatbed, or VT.");
  return option;
}

export function reviewPickupEquipment(
  pickups: readonly Pickup[], policies: readonly PickupEquipmentPolicy[], requested: EquipmentOption,
) {
  const stops = pickups.map(pickup => {
    const policy = policies.find(row => row.location_id === pickup.locationId &&
      (!row.effective_date || row.effective_date <= pickup.scheduledDate));
    const recorded = policy?.accepted_equipment;
    // Facility-specific confirmed restrictions take priority over dispatch defaults.
    const accepted = recorded === "van_only" || confirmedVanOnly.has(pickup.locationCode) ? "van_only"
      : policy?.verified && recorded === "van_and_flatbed" ? recorded
      : confirmedFlexible.has(pickup.locationCode) ? "van_and_flatbed"
      : "unknown";
    return { locationCode: pickup.locationCode, accepted };
  });
  const unknown = stops.filter(stop => stop.accepted === "unknown");
  const vanOnly = stops.filter(stop => stop.accepted === "van_only");
  const conflict = vanOnly.length > 0 && (requested === "VT" || requested === "flatbed");
  const reason = conflict ? `Van only at ${vanOnly.map(stop => stop.locationCode).join(", ")}.`
    : unknown.length ? `Confirm accepted equipment at ${unknown.map(stop => stop.locationCode).join(", ")}.` : null;
  const choice = requested === "auto" ? (vanOnly.length ? "van" : "VT") : requested;
  return { stops, choice: reason ? null : choice, reason,
    code: reason ? null : mcleodEquipmentCodes[choice] };
}
