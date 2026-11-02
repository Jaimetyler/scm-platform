import { createHash } from "node:crypto";

export type IntakeAttachment = {
  filename: string;
  bytes: Uint8Array;
};
export type IntakeMessage = {
  providerMessageId: string;
  sender: string;
  receivedAt: string;
  attachments: IntakeAttachment[];
};
export type ReportKind = "summary" | "detail";
export type IntakeReport = {
  warehouse: "HOU" | "SAV" | "843001" | "875260";
  kind: ReportKind;
  sha256: string;
  filename: string;
  bytes: Uint8Array;
};
const MAX_BYTES = 2_000_000;
function header(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 1200))
    .replace(/^\uFEFF/, "").toUpperCase();
}
export function classifyReport(attachment: IntakeAttachment): IntakeReport {
  if (!/\.csv$/i.test(attachment.filename) || !attachment.bytes.length || attachment.bytes.length > MAX_BYTES)
    throw new Error("Unsupported or oversized billing attachment");
  const text = header(attachment.bytes);
  const warehouse = /\(843001\)/.test(text) ? "843001"
    : /\(875260\)/.test(text) ? "875260"
    : /SAVANNAH|^SAV[- ]/.test(text) ? "SAV"
    : /SUPPLY CHAIN MANAGEMENT HOU/.test(text) ? "HOU" : null;
  const kind = /BILLING SUMMARY/.test(text) ? "summary"
    : /BILLING REPORT DETAIL TO EXPORT/.test(text) ? "detail" : null;
  if (!warehouse || !kind) throw new Error("Unrecognized billing report heading");
  return { warehouse, kind, filename: attachment.filename, bytes: attachment.bytes,
    sha256: createHash("sha256").update(attachment.bytes).digest("hex") };
}
export function prepareEmailIntake(message: IntakeMessage, allowedSenders: readonly string[]) {
  if (!message.providerMessageId.trim()) throw new Error("Missing provider message ID");
  if (!allowedSenders.some(sender => sender.toLowerCase() === message.sender.trim().toLowerCase()))
    throw new Error("Unapproved sender");
  if (!Number.isFinite(Date.parse(message.receivedAt))) throw new Error("Invalid received date");
  const reports = message.attachments.map(classifyReport);
  const groups = new Map<string, { summary?: IntakeReport; detail?: IntakeReport }>();
  for (const report of reports) {
    const group = groups.get(report.warehouse) || {};
    if (group[report.kind]) throw new Error(`Duplicate ${report.kind} for warehouse ${report.warehouse}`);
    group[report.kind] = report;
    groups.set(report.warehouse, group);
  }
  const pairs = [...groups.entries()].map(([warehouse, pair]) => {
    if (!pair.summary || !pair.detail) throw new Error(`Incomplete report pair for ${warehouse}`);
    return { warehouse, summary: pair.summary, detail: pair.detail };
  });
  if (!pairs.length) throw new Error("No billing report pairs");
  return { providerMessageId: message.providerMessageId, pairs, status: "awaiting_validation" as const };
}
