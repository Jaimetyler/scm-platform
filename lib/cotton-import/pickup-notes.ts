type Rule = {
  rule_kind: string;
  fee_type: string | null;
  amount: number | null;
  grace_days: number | null;
  grace_unit: string | null;
  notes: string | null;
};
export type PickupPolicyVersion = {
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  rules: Rule[];
};
type Pickup = { locationId: string; locationCode: string; scheduledDate: string };

export function effectivePickupPolicies(versions: readonly PickupPolicyVersion[], date: string) {
  return versions.filter(version => (!version.effective_from || version.effective_from <= date) &&
    (!version.effective_to || version.effective_to >= date));
}

const labels = { late_pickup: "Late pickup", early_pickup: "Early pickup" };
const units: Record<string, string> = {
  PER_BALE_ONE_TIME: "per bale, one time",
  PER_BALE_PER_DAY: "per bale per day",
};

export function draftPickupNotes(pickups: readonly Pickup[], policies: ReadonlyMap<string, PickupPolicyVersion[]>) {
  return pickups.map((pickup, index) => {
    const versions = effectivePickupPolicies(policies.get(pickup.locationId) ?? [], pickup.scheduledDate)
      .filter(version => !["retired", "superseded", "archived"].includes(version.status));
    const lines = (Object.keys(labels) as (keyof typeof labels)[]).map(kind => {
      const entries = versions.flatMap(version => version.rules.filter(rule => rule.rule_kind === kind)
        .map(rule => ({ rule, status: version.status })));
      if (entries.length !== 1) return `${labels[kind]}: ${entries.length ? "multiple rules on file; confirm applicable terms" : "policy not on file"}.`;
      const [{ rule, status }] = entries;
      const fee = rule.amount == null ? "fee amount unspecified" : `$${Number(rule.amount).toFixed(2)}`;
      const basis = rule.fee_type ? units[rule.fee_type] ?? rule.fee_type.toLowerCase().replaceAll("_", " ") : "";
      const grace = rule.grace_days == null ? "" : `; grace: ${rule.grace_days} ${rule.grace_unit?.toLowerCase().replaceAll("_", " ") || "days"}`;
      const detail = rule.notes?.trim();
      return `${labels[kind]} [${status}]: ${[fee, basis].filter(Boolean).join(" ")}${grace}.${detail ? ` ${detail}` : ""}`;
    });
    return { stopSequence: index + 1, locationCode: pickup.locationCode, type: "Dispatch comment",
      comment: [`Pickup policy · ${pickup.locationCode} · ${pickup.scheduledDate}`, ...lines].join("\n") };
  });
}
