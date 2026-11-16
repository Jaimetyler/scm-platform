"use client";

import type { BookingSyncPreview as Preview } from "@/lib/warehouse/outbound/booking-sync-preview";

export const mcleodCurrency = (value: number | null | undefined) =>
  value == null ? "Unavailable" : value.toLocaleString("en-US", { style: "currency", currency: "USD" });

type PayLine = { code?: string | null; description: string; amount: number | null };
function PayLines({ lines }: { lines?: PayLine[] | null }) {
  if (!lines) return "Unavailable";
  if (!lines.length) return "None";
  return <ul>{lines.map((line, index) =>
    <li key={index}>{[line.code, line.description, mcleodCurrency(line.amount)].filter(Boolean).join(" · ")}</li>
  )}</ul>;
}

export default function BookingSyncPreview({ row }: { row: Preview["rows"][number] }) {
  const { platform, order, issue } = row;
  if (!order) return <p>{issue}</p>;

  return <div className="booking-charge-table"><table>
    <thead><tr>{["Field", "Platform", "McLeod"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>
      {[
        ["Mark / BLNUM", platform.mark || "—", order.blnum || "—"],
        ["Container", platform.container || "—", order.container || "—"],
        ["Carrier", platform.carrier || "—", order.carrier || "—"],
        ["Base carrier pay", mcleodCurrency(platform.basePay), mcleodCurrency(order.basePay)],
        ["Other Carrier Pay", <PayLines key="planned" lines={platform.otherPay} />, <PayLines key="actual" lines={order.otherPay} />],
        ["Customer charges", <PayLines key="planned" lines={platform.customerCharges} />, <PayLines key="actual" lines={order.charges} />],
      ].map(([label, local, remote]) => <tr key={String(label)}><th scope="row">{label}</th><td>{local}</td><td>{remote}</td></tr>)}
    </tbody>
  </table></div>;
}
