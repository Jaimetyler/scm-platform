"use client";

import { useEffect, useState } from "react";
import { SCM_DELIVERY_LOCATIONS, terminalDeliveryCode, type DeliveryLocation, type InboundTerminal } from "@/lib/bunge/destinations";
import { requestedEquipment, type EquipmentOption } from "@/lib/cotton-import/equipment";
import styles from "../cotton-locations/outreach/outreach.module.css";
import layout from "./importer.module.css";

export const equipmentLabels = { auto: "Use pickup location rules", van: "Van", flatbed: "Flatbed", VT: "VT — van or flatbed" };
export type DispatchInput = { file: File; equipment: EquipmentOption; destination: string };

export default function DispatchUpload({ terminal, busy, onPreview, onChange }: {
  terminal: InboundTerminal; busy: boolean; onPreview: (input: DispatchInput) => void; onChange: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [equipment, setEquipment] = useState<EquipmentOption>("auto");
  const [destination, setDestination] = useState(() => terminalDeliveryCode(terminal, null));
  const [locations, setLocations] = useState<DeliveryLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const houston = terminal === "houston";
  const selected = locations.some(location => location.code === destination);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    async function load() {
      try {
        const response = await fetch(`/api/bunge-import?terminal=${terminal}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw Error(data.error || "Delivery locations unavailable.");
        if (!controller.signal.aborted) setLocations(data.locations);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setLocations([]);
          setError(cause instanceof Error ? cause.message : "Delivery locations unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [terminal, reload]);

  return <form className={styles.guide} onSubmit={event => {
    event.preventDefault();
    if (file && selected && !busy && !loading) onPreview({ file, equipment, destination });
  }}>
    <h2>Upload dispatch</h2>
    <p>Supported format: Bunge · {houston ? "XLSX or XLS, up to 2 MB" : "XLSX, XLS or CSV, up to 3 MB and 250 pickup rows"}.</p>
    <div className={layout.actions}>
      <input aria-label="Dispatch workbook" type="file" accept={houston ? ".xlsx,.xls" : ".xlsx,.xls,.csv"}
        disabled={busy} onChange={event => {
          if (file) setEquipment("auto");
          setFile(event.target.files?.[0] ?? null);
          onChange();
        }} />
      <label>SCM delivery location <select value={destination} disabled={busy || loading} onChange={event => {
        setDestination(event.target.value);
        onChange();
      }}>
        {!selected && <option value={destination} disabled>{loading ? "Loading delivery locations…" : `${destination} unavailable — choose a location`}</option>}
        {locations.map(location => <option key={location.code} value={location.code}>
          {SCM_DELIVERY_LOCATIONS.find(entry => entry.code === location.code)?.label ?? location.name} · {location.address}, {location.city} ({location.code})
        </option>)}
      </select></label>
      <button type="submit" disabled={busy || loading || !selected || !file}>{busy ? "Working…" : "Preview dispatch"}</button>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {error && <button type="button" disabled={loading || busy} onClick={() => setReload(value => value + 1)}>Retry delivery lookup</button>}
    <details className={layout.equipmentOverride}>
      <summary>{equipment === "auto" ? "Equipment override (optional)" : `Equipment override · ${equipmentLabels[equipment]}`}</summary>
      <p>Pickup locations set the default. Choose an override when the workbook requires specific equipment.</p>
      <label>Pickup equipment <select value={equipment} disabled={busy} onChange={event => {
        setEquipment(requestedEquipment(event.target.value));
        onChange();
      }}>
        {Object.entries(equipmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </details>
  </form>;
}
