import type { DrayInvoice } from "./model.ts";
import { money } from "./model.ts";

const payErrors = new Set([
  "No FirstStar container match", "Multiple FirstStar moves match this container / file",
  "FirstStar file reference differs from dray report", "FirstStar carrier pay is missing or invalid",
  "Carrier pay must be positive", "FirstStar load ID is invalid",
]);
export const canReviewDrayPay = (invoice: DrayInvoice) =>
  invoice.inputErrors.some(error => payErrors.has(error) || error.startsWith("Invalid container:") ||
    error === "Dray source must retain the full container number");

export function reviewedDrayBooking(value: unknown) {
  if (typeof value !== "string" || !/^[A-Z0-9][A-Z0-9_/-]{0,39}$/i.test(value.trim()))
    throw Error("Enter the exact booking number. Scientific notation cannot identify a booking.");
  return value.trim().toUpperCase();
}

export function reviewDrayInvoice(invoice: DrayInvoice, input: Record<string, unknown>): DrayInvoice {
  if (typeof input.container !== "string" || !/^[A-Z]{4}\d{7}$/.test(input.container.trim().toUpperCase()))
    throw Error("Enter the full container number including its check digit.");
  const container = input.container.trim().toUpperCase();
  const booking = reviewedDrayBooking(input.booking);
  if (typeof input.carrierPay !== "string" || !/^\d{1,6}(?:\.\d{1,2})?$/.test(input.carrierPay.trim()))
    throw Error("Enter a carrier pay amount in dollars with up to two decimals.");
  const carrierCents = money(input.carrierPay);
  if (carrierCents <= 0) throw Error("Carrier pay must be positive.");
  const inputErrors = invoice.inputErrors.filter(error => !payErrors.has(error) &&
    !error.startsWith("Invalid container:") && error !== "Dray source must retain the full container number");
  if (inputErrors.length) throw Error(inputErrors.join("; "));
  return { ...invoice, container, mark:container, booking, carrierCents, inputErrors,
    firstStarLoad: container === invoice.container && carrierCents === invoice.carrierCents ? invoice.firstStarLoad : null };
}

export function interchangeContainerMatches(container: string, filenames: string[]) {
  const candidates = new Map<string, Set<string>>();
  const source = container.trim().toUpperCase();
  for (const name of filenames) {
    const match = /^([A-Z]{4}\d{7})_(IN|OUT)\.PDF$/i.exec(name);
    if (!match) continue;
    const [number, direction] = [match[1].toUpperCase(), match[2].toLowerCase()];
    const documents = candidates.get(number) ?? new Set<string>();
    documents.add(direction);
    candidates.set(number, documents);
  }
  return [...candidates].map(([number, documents]) => ({
    container: number, documents: [...documents].sort(),
    differences: [...number].filter((char, index) => char !== source[index]).length,
  })).sort((a,b) => a.differences-b.differences || a.container.localeCompare(b.container)).slice(0, 8);
}
