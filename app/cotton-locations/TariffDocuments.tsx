"use client";

import { useRef, useState, type FormEvent } from "react";
import { existingTariffUrl, type ExistingTariff } from "@/lib/cotton-locations/existing-tariffs";
import styles from "./page.module.css";

export type TariffDocument = { id: string; filename: string; uploaded_at: string; uploaded_by: string };

export default function TariffDocuments({ locationId, documents, existingTariffs, canWrite, onBusy, onSaved }: {
  locationId: string; documents: TariffDocument[]; existingTariffs: ExistingTariff[];
  canWrite: boolean; onBusy: (busy: boolean) => void; onSaved: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file || busy || !canWrite) return;
    setBusy(true);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      const data = new FormData();
      data.set("locationId", locationId);
      data.set("file", file);
      const response = await fetch("/api/cotton-locations/outreach/documents", { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error || "Upload failed.");
      if (input.current) input.current.value = "";
      await onSaved();
      setNotice("Tariff saved to this location.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return <section className={styles.policyList} aria-label="Tariff documents">
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!documents.length && !existingTariffs.length && <p>No tariff documents on file for this location.</p>}
    {documents.map(document => <article className={styles.policyCard} key={document.id}>
      <a href={`/api/cotton-locations/outreach/documents?id=${document.id}`} target="_blank" rel="noreferrer">{document.filename}</a>
      <small>Uploaded {new Date(document.uploaded_at).toLocaleDateString()} · {document.uploaded_by}</small>
    </article>)}
    {existingTariffs.map(tariff => <article className={styles.policyCard} key={tariff.fileId}>
      <a href={existingTariffUrl(tariff.fileId)} target="_blank" rel="noreferrer">{tariff.filename}</a>
      <small>On file · Effective {tariff.effectiveDate || "date needs confirmation"}</small>
      <p>{tariff.note}</p>
    </article>)}
    {canWrite && <form className={styles.form} onSubmit={upload}>
      <label>Tariff file · PDF, JPEG or PNG up to 3 MB
        <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png" required disabled={busy} />
      </label>
      <button disabled={busy}>{busy ? "Uploading…" : "Upload tariff"}</button>
    </form>}
  </section>;
}
