"use client";

import { useState } from "react";
import type { CarrierRate } from "@/lib/warehouse/outbound/carrier-rates";
import { CarrierRateForm } from "../outbound/[terminal]/[siteCode]/[id]/CarrierRates";

export default function CarrierRateEditor({ initialRates, endpoint }: { initialRates: CarrierRate[]; endpoint: string }) {
  const [rates, setRates] = useState(initialRates);
  return <div className="carrier-rates-dialog">
    <CarrierRateForm rates={rates} endpoint={endpoint} onSaved={rate =>
      setRates(current => [...current.filter(item => item.id !== rate.id), rate])} />
  </div>;
}
