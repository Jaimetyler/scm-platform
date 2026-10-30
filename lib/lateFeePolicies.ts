import policies from "./lateFeePolicies.json";

export type LateFeePolicy = {
  mcleod_code: string;
  late_load_grace_days: number;
  avoidable_fee: boolean;
  amount: number;
  fee_type: string;
};

export function getPolicyMap(): Map<string, LateFeePolicy> {
  const map = new Map<string, LateFeePolicy>();

  for (const p of policies as LateFeePolicy[]) {
    if (!p.mcleod_code) continue;

    const key = String(p.mcleod_code).trim();

    map.set(key, {
      ...p,
      fee_type: String(p.fee_type || "").toUpperCase(),
      late_load_grace_days: Number(p.late_load_grace_days || 0),
      amount: Number(p.amount || 0),
      avoidable_fee:
        typeof p.avoidable_fee === "boolean"
          ? p.avoidable_fee
          : String(p.avoidable_fee).toUpperCase() === "TRUE",
    });
  }

  return map;
}

export function calculateLateFee(
  policy: LateFeePolicy | undefined,
  bales: number,
  daysLate: number
): number {
  if (!policy || policy.fee_type === "NONE") return 0;

  const d = daysLate;
  const rate = Number(policy.amount || 0);

  switch (policy.fee_type) {
    case "FLAT":
      return d > 0 ? rate : 0;

    case "PER_DAY":
      return d * rate;

    case "PER_BALE_ONE_TIME":
      return d > 0 ? bales * rate : 0;

    case "PER_BALE_PER_DAY":
      return bales * d * rate;

    default:
      return 0;
  }
}