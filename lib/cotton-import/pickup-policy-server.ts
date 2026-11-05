import type { staffDatabase } from "@/lib/auth/session";
import type { PickupPolicyVersion } from "./pickup-notes";

export async function readPickupPolicies(db: ReturnType<typeof staffDatabase>, uniqueIds: string[]) {
  const policyByLocation = new Map<string, PickupPolicyVersion[]>();
  if (uniqueIds.length) {
    const policies = await db.from("cotton_location_policy_versions")
      .select("id,location_id,status,effective_from,effective_to")
      .in("location_id",uniqueIds).limit(5000);
    if (policies.error || !policies.data)
      throw new Error("Location policies unavailable.");
    const versionIds = policies.data.map(p=>p.id);
    const rules = versionIds.length
      ? await db.from("cotton_location_policy_rules")
          .select("policy_version_id,rule_kind,fee_type,amount,grace_days,grace_unit,avoidable_fee,conditions,notes")
          .in("policy_version_id",versionIds).limit(5000)
      : {data:[],error:null};
    if (rules.error || !rules.data)
      throw new Error("Location policy rules unavailable.");
    for (const p of policies.data) {
      const list = policyByLocation.get(p.location_id) ?? [];
      list.push({status:p.status,effective_from:p.effective_from,effective_to:p.effective_to,
        rules:rules.data.filter(r=>r.policy_version_id===p.id)});
      policyByLocation.set(p.location_id,list);
    }
  }
  return policyByLocation;
}
