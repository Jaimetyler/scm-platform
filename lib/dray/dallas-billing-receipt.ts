import { randomUUID } from "node:crypto";
import type { staffDatabase } from "../auth/session";
import type { CustomerCharge } from "./dallas-customer-extras";

type ChargeValues = Pick<CustomerCharge, "units" | "rate" | "amount">;
type Entry = {
  code: string;
  original: { id: string; values: ChargeValues } | null;
  attempted: ChargeValues[];
  chargeId?: string;
};

export type BillingReceipt = { charges: Entry[]; restoringFromTotal?: number };
type Payload = Record<string, unknown> & {
  outboundBillingReceipt?: BillingReceipt;
  outboundBillingLock?: { id: string; expires: number };
};
type Link = { blnum: string; order_id: string; payload: Payload };

export function sameChargeValues(a: ChargeValues, b: ChargeValues) {
  return a.units === b.units && a.rate === b.rate && a.amount !== null && b.amount !== null &&
    Math.round(a.amount * 100) === Math.round(b.amount * 100);
}

export async function lockDallasBilling(db: ReturnType<typeof staffDatabase>, bookingId: string, link: Link) {
  let payload = link.payload;
  if (payload.outboundBillingLock && payload.outboundBillingLock.expires > Date.now())
    throw Error("This load is already syncing billing. Retry after it finishes.");
  const lock = { id: randomUUID(), expires: Date.now() + 180_000 };

  async function save(next: Payload) {
    const { data, error } = await db.from("dallas_dray_import_loads").update({ payload: next })
      .eq("booking_id", bookingId).eq("blnum", link.blnum).eq("order_id", link.order_id)
      .eq("state", "verified").eq("payload", JSON.stringify(payload)).select("blnum").maybeSingle();
    if (error || !data) throw Error("The Dallas billing history changed. Reload and try again.");
    payload = next;
  }

  await save({ ...payload, outboundBillingLock: lock });
  return {
    get receipt() { return payload.outboundBillingReceipt; },
    async record(receipt?: BillingReceipt) {
      const next = { ...payload };
      if (receipt) next.outboundBillingReceipt = receipt;
      else delete next.outboundBillingReceipt;
      await save(next);
    },
    async release() {
      const next = { ...payload };
      delete next.outboundBillingLock;
      await save(next);
    },
  };
}

export function rememberDallasCharge(receipt: BillingReceipt | undefined, code: string, current: CustomerCharge | null,
  desired: ChargeValues): BillingReceipt {
  if (receipt?.restoringFromTotal !== undefined) throw Error("Customer charge restoration is pending. Finish unassigning this load first.");
  const charges = receipt?.charges ?? [];
  const entry = charges.find(row => row.code === code);
  const matchesSaved = current && entry && (entry.chargeId === current.id || entry.original?.id === current.id) &&
    (entry.attempted.some(values => sameChargeValues(values, current)) ||
      (entry.original && sameChargeValues(entry.original.values, current)));
  const retryMissingCreate = !current && entry && !entry.original && !entry.chargeId;
  if (entry && !matchesSaved && !retryMissingCreate)
    throw Error(`${code} changed outside SCM Platform. Review the customer charge before syncing.`);
  const next: Entry = {
    code,
    original: entry ? entry.original : current ? { id: current.id, values: { units: current.units, rate: current.rate, amount: current.amount } } : null,
    attempted: [...(entry?.attempted ?? []).filter(values => !sameChargeValues(values, desired)), { units: desired.units, rate: desired.rate, amount: desired.amount }],
    chargeId: current?.id || entry?.chargeId,
  };
  return { charges: [...charges.filter(row => row.code !== code), next] };
}
