"use client";
import { attachBookingFile } from "@/lib/warehouse/outbound/upload-client";
import { useCanWrite, useStaff } from "@/components/auth/StaffSession";
import Link from "next/link";
import { useWarehouseViewState } from "@/components/warehouse/useWarehouseViewState";
import { safeOutboundReturn } from "@/lib/warehouse/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { useParams, useSearchParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import CutoffInput from "@/components/warehouse/CutoffInput";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { bookingReturnLocationLabel } from "@/lib/warehouse/outbound/return-location";
import { bookingDateInput, formatBookingDate } from "@/lib/warehouse/outbound/details";

import { containerInfoRows, containerInfoText, containerInfoHtml } from "@/lib/warehouse/outbound/container-info-rows";
import "./booking.css";
import { bookingChargeCustomer } from "@/lib/dray/booking-customers";
import BookingCharges from "./BookingCharges";
import DallasOrderPilot from "./DallasOrderPilot";
import { BookingOrderLookup, CarrierBatchToolbar, CarrierEditor, CarrierRateManager, CarrierSummary } from "./CarrierRates";
import { carrierBatchSelection, carrierPlanTotals, type CarrierBatchAction, type CarrierPlan, type CarrierRate, type CarrierSelection, type CustomerBillRates } from "@/lib/warehouse/outbound/carrier-rates";
import { isSavannahE2openBooking } from "@/lib/warehouse/outbound/e2open-customer";
import { useVisiblePolling } from "@/components/warehouse/useVisiblePolling";
import { bookingMarkBadges } from "@/lib/warehouse/outbound/marks";
import { bookingBaleDisplay } from "@/lib/warehouse/outbound/bale-display";

type Container = { id: string; sequence_no: number; booking_line_id: string | null; container_number: string | null; seal_number: string | null;
  chassis_number: string | null; notes: string | null; updated_at: string; split_transfer_id: string | null;
  carrier_plan: CarrierPlan | null;
  split: { mark: string; bales: number; target_booking_id: string; target_booking_number: string } | null };
type Line = { id: string; source_row: number; mark: string; requested_bales: number; mark_requested_total: number; available_bales: number; warehouse_bales: number;
  line_status: "active" | "on_hold" | "cancelled"; load_source: "warehouse" | "source_load"; status_note: string | null; source_warehouse: string;
  source_arrivals: { arrival_site_name: string; checkin_id: string | null }[]; load_by: string | null; shipping_order: string | null; inventory_locations: string[]; has_break_inventory: boolean; inbound_bales: number; inbound_statuses: string[] };
type Booking = { site_code: string; steamship_line?: string | null; return_location?: string | null; return_location_code?: string | null; scm_file_number?: string | null; id: string; booking_number: string; customer: string; customer_reference: string | null;
  requested_bales: number; planned_containers: number | null; site_name: string; status: string; doc_cutoff_has_time: boolean; cutoff_has_time: boolean; erd: string | null; doc_cutoff: string | null; cutoff: string | null; vessel: string | null; updated_at: string };
type McLeodDocumentCheck = { container: string; mark: string; orderId: string | null; movementId: string | null; movementImagesAvailable: boolean; status: string; documentTypes: { id: string; description: string }[]; existingImages: { id: string; type: string; description: string; scanDate: string; scope: string }[] };
type McLeodUploadResult = { container: string; orderId?: string; file?: string; status: string };
type E2openDocuments = { bols: string[]; containers: { container: string; inbound: string | null; outbound: string | null }[] };
type Draft = { bookingLineId: string; containerNumber: string; sealNumber: string; chassisNumber: string; notes: string };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8,
  border: "1px solid #475569", background: "#0f172a", color: "#f8fafc" };
const button: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: "1px solid #475569",
  background: "#0f172a", color: "#f8fafc", cursor: "pointer", fontWeight: 700, textDecoration: "none" };
const th: React.CSSProperties = { padding: "10px", borderBottom: "1px solid #475569", color: "#94a3b8", fontSize: 12, textAlign: "left" };
const td: React.CSSProperties = { padding: "9px 10px", borderBottom: "1px solid rgba(71,85,105,.45)" };

export default function CottonOutboundBookingPage() {
  const queryParams = useSearchParams();
  const params = useParams<{ terminal: string; siteCode: string; id: string }>();
  const terminal = String(params.terminal ?? "").toUpperCase();
  const canManage = useCanWrite(terminal);
  const isAdmin = useStaff()?.role === "admin";
  const siteCode = String(params.siteCode ?? "");
  const id = String(params.id ?? "");
  const locationOptions = terminal === "DAL" ? CHECKIN_SITES.filter(site => site.terminal === terminal && site.materials.includes("cotton")) : [];
  const requestedReturn = queryParams.get("returnTo");
  const backHref = safeOutboundReturn(requestedReturn) ?? `/warehouse/outbound?terminal=${terminal}&siteCode=${siteCode}`;
  const [booking, setBooking] = useState<Booking | null>(null);
  const canWrite = canManage && booking?.status === "draft";
  const carrierEndpoint = `/api/warehouse/outbound/bookings/${id}/carrier-rates`;
  const [selectedContainers, setSelectedContainers] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [detailId, setDetailId] = useState("");
  const detailDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (detailId && detailDialog.current && !detailDialog.current.open) detailDialog.current.showModal();
  }, [detailId]);
  const [customerBilling, setCustomerBilling] = useState<CustomerBillRates | null>(null);
  const [carrierRates, setCarrierRates] = useState<CarrierRate[]>([]);
  const [carrierError, setCarrierError] = useState("");
  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    setCarrierRates([]);
    setCustomerBilling(null);
    setCarrierError("");
    fetch(carrierEndpoint, { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!controller.signal.aborted) { setCarrierRates(result.rates); setCustomerBilling(result.customerBilling); }
    }).catch(error => {
      if (!controller.signal.aborted) setCarrierError(error.message || "Could not load carrier rates.");
    });
    return () => controller.abort();
  }, [canManage, carrierEndpoint, siteCode, booking?.return_location, booking?.return_location_code]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [operation, setWorking] = useState("");
  const working = bulkSaving ? "carrier-batch" : operation;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useWarehouseViewState("search", "");
  const [rollMode, setRollMode] = useState(false);
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [rollBooking, setRollBooking] = useState("");
  const [rollQuantities, setRollQuantities] = useState<Record<string, string>>({});
  const [newMark, setNewMark] = useState<{ requestId: string; mark: string; bales: string; shippingOrder: string } | null>(null);
  const [markError, setMarkError] = useState("");
  const [markAction, setMarkAction] = useState<{ line: Line; action: "hold" | "resume" | "cancel" | "warehouse" | "keep_source"; note: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);
  const [details, setDetails] = useState({ scmFileNumber: "", erd: "", docCutoff: "", cutoff: "", vessel: "", returnLocation: "", steamshipLine: "", destinationSiteCode: siteCode });
  const [importedDateNotes, setImportedDateNotes] = useState<string[]>([]);
  const [e2openDocuments, setE2openDocuments] = useState<E2openDocuments | null>(null);
  const [e2openLoading, setE2openLoading] = useState(false);
  const [e2openError, setE2openError] = useState("");
  const [mcleodCheck, setMcleodCheck] = useState<McLeodDocumentCheck | null>(null);
  const [mcleodLoading, setMcleodLoading] = useState("");
  const [mcleodError, setMcleodError] = useState("");
  const [mcleodSending, setMcleodSending] = useState(false);
  const [mcleodResults, setMcleodResults] = useState<McLeodUploadResult[]>([]);
  const requestInput = useRef<HTMLInputElement>(null);
  const saveTimers = useRef<Record<string, number>>({});
  const savingRows = useRef(new Set<string>());

  const load = useCallback(async (preserve?: { containers: Record<string, Container>; drafts: Record<string, Draft> }) => {
    try {
      const query = new URLSearchParams({ terminal, siteCode });
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooking(result.booking); setContainers((result.containers as Container[]).map((row) => preserve?.containers[row.id] ?? row)); setLines(result.lines); setSelectedLines(new Set());
      setDrafts(Object.fromEntries((result.containers as Container[]).map((row) => [row.id, {
        bookingLineId: row.booking_line_id ?? "", containerNumber: row.container_number ?? "", sealNumber: row.seal_number ?? "",
        chassisNumber: row.chassis_number ?? "", notes: row.notes ?? "",
        ...preserve?.drafts[row.id],
      }])));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load booking"); }
    finally { setLoading(false); }
  }, [id, terminal, siteCode]);
  useEffect(() => { void load(); }, [load]);
  const [activeLine, setActiveLine] = useState<{ bookingId: string; numbers: Record<string, number[]> } | null>(null);
  useVisiblePolling({
    intervalMs: 10000,
    enabled: Boolean(booking),
    requestKey: `${terminal}:${siteCode}:${id}`,
    load: async (signal) => {
      const query = new URLSearchParams({ terminal, siteCode, view: "active-line" });
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}?${query}`, { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error("Could not refresh booking line numbers");
      if (!signal.aborted) setActiveLine({ bookingId: id, numbers: result.numbers });
    },
  });

  useEffect(() => () => { Object.values(saveTimers.current).forEach((timer) => window.clearTimeout(timer)); }, []);

  function change(row: Container, field: keyof Draft, value: string) {
    if (row.split_transfer_id || lines.find((line) => line.id === row.booking_line_id)?.line_status !== "active" && row.booking_line_id) return;
    const nextValue = field === "chassisNumber" && terminal === "SAV" && /^\d/.test(value)
      ? `SCMI${value.toUpperCase()}`
      : field === "notes" || field === "bookingLineId" ? value : value.toUpperCase();
    const next = { ...drafts[row.id], [field]: nextValue };
    setDrafts((current) => ({ ...current, [row.id]: next }));
    setMessage("");
    if (saveTimers.current[row.id]) window.clearTimeout(saveTimers.current[row.id]);
    saveTimers.current[row.id] = window.setTimeout(() => void save(row, next), 700);
  }
  async function save(row: Container, draftToSave: Draft, carrierPlan?: CarrierSelection | null, batch = false) {
    if (row.split_transfer_id || lines.find((line) => line.id === row.booking_line_id)?.line_status !== "active" && row.booking_line_id) return;
    if (savingRows.current.has(row.id)) return;
    window.clearTimeout(saveTimers.current[row.id]);
    delete saveTimers.current[row.id];
    savingRows.current.add(row.id);
    if (!batch) { setWorking(row.id); setError(""); setMessage(""); }
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/containers`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, containerId: row.id, expectedUpdatedAt: row.updated_at, ...draftToSave, carrierPlan }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const persisted: Container = result.container;
      setContainers((current) => current.map((item) => item.id === row.id ? { ...item, ...persisted } : item));
      setDrafts((current) => current[row.id] !== draftToSave ? current : {
        ...current,
        [row.id]: { bookingLineId: persisted.booking_line_id ?? "", containerNumber: persisted.container_number ?? "",
          sealNumber: persisted.seal_number ?? "", chassisNumber: persisted.chassis_number ?? "", notes: persisted.notes ?? "" },
      });
      if (persisted.container_number !== row.container_number) {
        setE2openDocuments(null);
        setMcleodCheck(null);
      }
      if (!batch) setMessage(`Container ${row.sequence_no} saved.`);
      return true;
    } catch (reason) {
      if (batch) throw reason;
      setError(reason instanceof Error ? reason.message : "Could not save container");
    } finally {
      savingRows.current.delete(row.id);
      if (!batch) setWorking("");
    }
  }
  function pendingEquipment() {
    const dirty = containers.filter((row) => {
      const draft = drafts[row.id];
      return draft && (draft.bookingLineId !== (row.booking_line_id ?? "") || draft.containerNumber !== (row.container_number ?? "") ||
        draft.sealNumber !== (row.seal_number ?? "") || draft.chassisNumber !== (row.chassis_number ?? "") || draft.notes !== (row.notes ?? ""));
    });
    return { containers: Object.fromEntries(dirty.map((row) => [row.id, row])), drafts: Object.fromEntries(dirty.map((row) => [row.id, drafts[row.id]])) };
  }
  async function addMark(event: React.FormEvent) {
    event.preventDefault();
    if (!newMark || !booking || working) return;
    setWorking("add-mark"); setMarkError(""); setMessage("");
    const preserve = pendingEquipment();
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/lines`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, expectedUpdatedAt: booking.updated_at, ...newMark, bales: Number(newMark.bales) }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not add mark");
      setNewMark(null); setSearch("");
      await load(preserve);
      setMessage(`${newMark.mark.trim().toUpperCase()} added to booking with ${newMark.bales} requested bales.`);
    } catch (reason) { setMarkError(reason instanceof Error ? reason.message : "Could not add mark"); }
    finally { setWorking(""); }
  }

  function chooseMarkAction(line: Line, action: "hold" | "resume" | "cancel" | "warehouse" | "keep_source") {
    setActionError(""); setMarkAction({ line, action, note: "" });
  }
  async function changeMark(event: React.FormEvent) {
    event.preventDefault();
    if (!markAction || !booking || working) return;
    const preserve = pendingEquipment();
    if (containers.some((row) => row.booking_line_id === markAction.line.id && preserve.drafts[row.id])) {
      setActionError("Finish or clear this mark’s unsaved equipment details before changing its plan."); return;
    }
    setWorking("mark-action"); setActionError("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/lines/${markAction.line.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, expectedUpdatedAt: booking.updated_at, action: markAction.action, note: markAction.note }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await load(preserve); setMarkAction(null); setRollMode(false);
      setMessage(`${markAction.line.mark}: ${markAction.action === "hold" ? "placed on hold" : markAction.action === "resume" ? "resumed" : markAction.action === "cancel" ? "cancelled from this booking" : markAction.action === "warehouse" ? "converted to warehouse load" : "arrival reviewed; remains a source load"}.`);
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not change mark"); }
    finally { setWorking(""); }
  }

  function toggleLine(line: Line) {
    setSelectedLines((current) => {
      const next = new Set(current);
      if (next.has(line.id)) next.delete(line.id); else next.add(line.id);
      return next;
    });
    setRollQuantities((current) => ({ ...current, [line.id]: current[line.id] || String(line.requested_bales) }));
  }
  async function rollSelected() {
    const moves = [...selectedLines].map((lineId) => ({ lineId, bales: Number(rollQuantities[lineId]) }));
    const preserve = pendingEquipment();
    setWorking("bulk-roll"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/rollover`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, targetBookingNumber: rollBooking, moves }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setRollBooking(""); setRollQuantities({}); setSelectedLines(new Set()); setRollMode(false);
      setMessage(`${moves.length} mark${moves.length === 1 ? "" : "s"} moved to booking ${result.targetBookingNumber}.`);
      await load(preserve);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not roll selected marks"); }
    finally { setWorking(""); }
  }

  async function copyContainerInfo() {
    if (!booking) return;
    setError(""); setMessage("");
    if (working || Object.keys(pendingEquipment().drafts).length) {
      setError("Finish saving equipment details before copying container information."); return;
    }
    try {
      const rows = containerInfoRows(lines, containers);
      const text = containerInfoText(booking, rows);
      if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([containerInfoHtml(booking, rows)], { type: "text/html" }) })]);
      } else await navigator.clipboard.writeText(text);
      setMessage("Container information copied. Paste it into your email or spreadsheet.");
    } catch { setError("Clipboard access failed. Try again or use Export Container Info."); }
  }

  async function checkE2openDocuments() {
    setE2openLoading(true);
    setE2openDocuments(null);
    setE2openError("");
    try {
      const query = new URLSearchParams({ terminal, siteCode, documents: "e2open" });
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not check SharePoint.");
      setE2openDocuments(result);
    } catch (error) {
      setE2openError(error instanceof Error ? error.message : "Could not check SharePoint.");
    } finally {
      setE2openLoading(false);
    }
  }

  async function checkMcleodOrder(container: string) {
    setMcleodLoading(container);
    setMcleodCheck(null);
    setMcleodError("");
    try {
      const query = new URLSearchParams({ terminal, siteCode, documents: "mcleod", container });
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not check McLeod.");
      setMcleodCheck(result);
    } catch (error) {
      setMcleodError(error instanceof Error ? error.message : "Could not check McLeod.");
    } finally {
      setMcleodLoading("");
    }
  }

  async function sendMcleodDocuments(retryBol?: string) {
    setMcleodSending(true);
    setMcleodResults([]);
    setMcleodError("");
    setMcleodCheck(null);
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}/mcleod-documents`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ terminal, siteCode, retryBol }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not send booking documents.");
      setMcleodResults(result.results);
    } catch (error) {
      setMcleodError(error instanceof Error ? error.message : "Could not send booking documents.");
    } finally {
      setMcleodSending(false);
    }
  }

  function editDetails() {
    if (!booking) return;
    setDetails({ scmFileNumber: booking.scm_file_number ?? "", erd: bookingDateInput(booking.erd), docCutoff: bookingDateInput(booking.doc_cutoff, booking.doc_cutoff_has_time !== false),
      cutoff: bookingDateInput(booking.cutoff, booking.cutoff_has_time !== false), vessel: booking.vessel ?? "", returnLocation: booking.return_location ?? "", steamshipLine: booking.steamship_line ?? "", destinationSiteCode: siteCode });
    setEditingDetails(true);
    setImportedDateNotes([]);
  }
  async function importDetails(file: File) {
    if (!booking) return;
    setWorking("import-details"); setError(""); setMessage("");
    try {
      const body = new FormData();
      await attachBookingFile(body, file, terminal); body.set("terminal", terminal); body.set("siteCode", siteCode);
      const response = await fetch("/api/warehouse/outbound/preview", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.booking.bookingNumber !== booking.booking_number) throw new Error(`This file belongs to booking ${result.booking.bookingNumber}, not ${booking.booking_number}.`);
      const source = result.booking;
      if (!source.erd && !source.docCutoff && !source.cutoff && !source.vessel && !source.returnLocation && !source.steamshipLine && !source.detailNotes?.length) throw new Error("No sailing details were found in this request.");
      setDetails({ scmFileNumber: booking.scm_file_number ?? "", erd: source.erd ?? bookingDateInput(booking.erd),
        docCutoff: source.docCutoff ?? bookingDateInput(booking.doc_cutoff, booking.doc_cutoff_has_time !== false),
        cutoff: source.cutoff ?? bookingDateInput(booking.cutoff, booking.cutoff_has_time !== false), vessel: source.vessel ?? booking.vessel ?? "", returnLocation: source.returnLocation || booking.return_location || "",
        steamshipLine: source.steamshipLine || booking.steamship_line || "", destinationSiteCode: siteCode });
      setImportedDateNotes([...(source.sourceDates ?? []).map(({ label, value }: { label: string; value: string }) => `${label}: ${formatBookingDate(value, value.includes("T"))}`), ...(source.detailNotes ?? [])]);
      setEditingDetails(true); setMessage("Review the imported booking details, then save.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import booking details"); }
    finally { setWorking(""); if (requestInput.current) requestInput.current.value = ""; }
  }
  async function changeBookingStatus(lifecycleStatus: "draft" | "archived" | "cancelled") {
    if (!booking || !canManage || working || mcleodSending || editingDetails) return;
    if (Object.keys(pendingEquipment().drafts).length) {
      setError("Finish saving equipment details first.");
      return;
    }
    if (lifecycleStatus === "cancelled" && !window.confirm(`Delete booking ${booking.booking_number} from Active? You can restore it from Booking history.`)) return;
    if (lifecycleStatus === "archived" && !window.confirm(`Complete booking ${booking.booking_number} and move it to Booking history?`)) return;
    setWorking("booking-status"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, expectedUpdatedAt: booking.updated_at, lifecycleStatus }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const listUrl = new URL(backHref, window.location.origin);
      listUrl.searchParams.delete("bookingStatus");
      if (lifecycleStatus === "draft") listUrl.searchParams.set("view", "all");
      window.location.assign(listUrl.pathname + listUrl.search);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update booking status.");
    } finally { setWorking(""); }
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    if (details.destinationSiteCode !== siteCode && Object.keys(pendingEquipment().drafts).length) {
      setError("Finish saving equipment details before changing the warehouse.");
      return;
    }
    setWorking("details"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/warehouse/outbound/bookings/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal, siteCode, expectedUpdatedAt: booking?.updated_at, ...details }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.booking.site_code !== siteCode) {
        const returnUrl = new URL(backHref, window.location.origin);
        if (returnUrl.searchParams.get("siteCode") === siteCode) returnUrl.searchParams.set("siteCode", result.booking.site_code);
        const returnTo = encodeURIComponent(returnUrl.pathname + returnUrl.search);
        window.location.replace(`/warehouse/outbound/${terminal.toLowerCase()}/${result.booking.site_code}/${id}?returnTo=${returnTo}`);
        return;
      }
      setBooking(result.booking); setEditingDetails(false); setMessage("Booking details updated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update booking details"); }
    finally { setWorking(""); }
  }

  if (loading) return <main style={{ color: "#e2e8f0" }}>Loading booking…</main>;
  if (!booking) return <main><PlatformPageHeader title="Outbound Booking Not Found" actions={<Link href={backHref} style={button}>Back</Link>} />{error && <p style={{ color: "#fca5a5" }}>{error}</p>}</main>;
  const activeContainers = containers.filter((row) => !row.split_transfer_id && (!row.booking_line_id || lines.find((line) => line.id === row.booking_line_id)?.line_status === "active"));
  const complete = activeContainers.filter((row) => row.container_number && row.seal_number && row.chassis_number).length;
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const term = search.trim().toUpperCase();
  const visibleContainers = containers.filter((row) => {
    const assigned = row.booking_line_id ? lineById.get(row.booking_line_id) : null;
    return !term || [row.sequence_no, row.container_number, row.seal_number, row.chassis_number, row.notes,
      assigned?.mark, assigned?.shipping_order, row.split?.mark, row.split?.target_booking_number].some((value) => String(value ?? "").toUpperCase().includes(term));
  }).sort((a, b) => {
    const rank = (row: Container) => {
      const line = row.booking_line_id ? lineById.get(row.booking_line_id) : null;
      return row.split_transfer_id ? 4 : line?.line_status === "cancelled" ? 3 : line?.line_status === "on_hold" ? 2 : line?.load_source === "source_load" ? 1 : 0;
    };
    return rank(a) - rank(b) || a.sequence_no - b.sequence_no;
  });
  const selectionEnabled = canWrite && !rollMode;
  const pending = pendingEquipment().drafts;
  const selectableRows = selectionEnabled ? visibleContainers.filter(row => (row.container_number || row.booking_line_id) && !row.split_transfer_id &&
    !pending[row.id] && drafts[row.id] && (!row.booking_line_id || lineById.get(row.booking_line_id)?.line_status === "active")) : [];
  const selectableIds = new Set(selectableRows.map(row => row.id));
  const selectedRows = selectableRows.filter(row => selectedContainers.has(row.id));
  const detailRow = containers.find(row => row.id === detailId);
  const detailLine = detailRow?.booking_line_id ? lineById.get(detailRow.booking_line_id) : undefined;
  const detailDraft = detailRow ? drafts[detailRow.id] : undefined;
  const orderLookup = terminal === "DAL" && bookingChargeCustomer(booking.customer) || isSavannahE2openBooking(terminal, booking.customer);
  const hasletPilot = isAdmin && terminal === "DAL" && siteCode === "SCMDDETX" &&
    bookingChargeCustomer(booking.customer)?.code === "OLAMRITX" &&
    bookingReturnLocationLabel(booking.return_location, booking.return_location_code) === "BNSF Haslet";

  function toggleContainers(ids: string[], selected: boolean) {
    setSelectedContainers(current => {
      const next = new Set(current);
      for (const rowId of ids) selected ? next.add(rowId) : next.delete(rowId);
      return next;
    });
  }
  async function applyCarrierBatch(action: CarrierBatchAction) {
    if (working || bulkSaving || !selectedRows.length) return;
    setError(""); setMessage("");
    let updates;
    try {
      updates = selectedRows.map(row => ({ row, plan: carrierBatchSelection(row.carrier_plan, action) }));
    } catch (reason) {
      setError((reason as Error).message);
      return;
    }
    setBulkSaving(true);
    const saved: string[] = [];
    const failed: string[] = [];
    try {
      for (const { row, plan } of updates) {
        try {
          if (await save(row, drafts[row.id], plan, true)) saved.push(row.id);
          else failed.push(`${row.container_number}: another edit is in progress`);
        } catch (reason) {
          failed.push(`${row.container_number}: ${(reason as Error).message || "could not save"}`);
        }
      }
      toggleContainers(saved, false);
      if (saved.length) setMessage(`Saved ${"rate" in action ? "carrier" : "charge"} on ${saved.length} container${saved.length === 1 ? "" : "s"}.`);
      if (failed.length) setError(`Review ${failed.length} container${failed.length === 1 ? "" : "s"} before retrying. ${failed.join(" · ")}`);
    } finally { setBulkSaving(false); }
  }
  return <main className="outbound-booking" style={{ maxWidth: "none", width: "100%", margin: "0 auto", color: "#e2e8f0" }}>
    <PlatformPageHeader title={booking.scm_file_number ? `SCM File # ${booking.scm_file_number}` : `Booking ${booking.booking_number}`}
      subtitle={`${booking.customer} · ${booking.scm_file_number ? `Booking ${booking.booking_number} · ` : ""}${booking.site_name}`}
      actions={<><Link href={backHref} style={button}>← Booking list</Link>
        {canWrite && <button type="button" style={{ ...button, borderColor: "#15803d", background: "#14532d" }}
          disabled={Boolean(working) || mcleodSending || editingDetails}
          onClick={() => void changeBookingStatus("archived")}>Complete booking</button>}
        <details className="booking-actions"><summary style={button}>Actions ▾</summary><div className="booking-actions-menu">
          <Link href={`/warehouse/outbound/${terminal}/${siteCode}/${id}/print`} target="_blank">Print File</Link>
          <a href={`/api/warehouse/outbound/bookings/${id}/export?terminal=${terminal}&siteCode=${siteCode}`}>Export Booking</a>
          <a href={`/api/warehouse/outbound/bookings/${id}/container-info?terminal=${terminal}&siteCode=${siteCode}`}>Export Container Info</a>
          <button type="button" disabled={Boolean(working)} onClick={() => void copyContainerInfo()}>Copy Container Info</button>
          <button type="button" disabled={!canWrite || Boolean(working) || editingDetails} onClick={editDetails}>Edit booking details</button>
          <button type="button" disabled={!canWrite || Boolean(working) || editingDetails} onClick={() => requestInput.current?.click()}>Import booking details</button>
          {canManage && (booking.status === "draft" ?
            <button type="button" disabled={Boolean(working) || mcleodSending || editingDetails} onClick={() => void changeBookingStatus("cancelled")}>Delete booking</button>
          : <button type="button" disabled={Boolean(working)} onClick={() => void changeBookingStatus("draft")}>Restore to active bookings</button>)}
        </div></details></>} />
    {canWrite && terminal === "DAL" && bookingChargeCustomer(booking.customer) && <BookingCharges key={id} bookingId={id} bookingNumber={booking.booking_number} customerReference={booking.customer_reference} />}
    {canWrite && isSavannahE2openBooking(terminal, booking.customer) && <PlatformPanel>
      <button type="button" style={button} disabled={e2openLoading} onClick={() => void checkE2openDocuments()}>
        {e2openLoading ? "Checking SharePoint…" : "Check e2open documents"}
      </button>
      {e2openError && <p role="alert">{e2openError}</p>}
      {e2openDocuments && <div aria-live="polite">
        <p><strong>Warehouse BOLs in SharePoint</strong> {e2openDocuments.bols.join(", ") || "None found"}</p>
        <table>
          <thead><tr><th style={th}>Container</th><th style={th}>Ingate POD</th><th style={th}>Outgate POD</th><th style={th}>McLeod</th></tr></thead>
          <tbody>{e2openDocuments.containers.map((row) => <tr key={row.container}>
            <td style={td}>{row.container}</td><td style={td}>{row.inbound ?? "Missing"}</td><td style={td}>{row.outbound ?? "Missing"}</td>
            <td style={td}><button type="button" style={button} disabled={Boolean(mcleodLoading || working || mcleodSending)}
              onClick={() => void checkMcleodOrder(row.container)}>{mcleodLoading === row.container ? "Checking…" : "Check SCM order"}</button>
              <button type="button" style={{ ...button, marginLeft: 6 }}
                disabled={Boolean(mcleodLoading || working || mcleodSending || Object.keys(pendingEquipment().drafts).length)}
                onClick={() => void sendMcleodDocuments(row.container)}>Retry this BOL with movement ID</button></td>
          </tr>)}</tbody>
        </table>
        <button type="button" style={{ ...button, marginTop: 10 }}
          disabled={mcleodSending || Boolean(mcleodLoading || working) || !e2openDocuments.containers.length || Boolean(Object.keys(pendingEquipment().drafts).length)}
          onClick={() => void sendMcleodDocuments()}>
          {mcleodSending ? "Checking and sending…" : "Send booking documents to McLeod"}
        </button>
        {mcleodError && <p role="alert">{mcleodError}</p>}
        {mcleodResults.length > 0 && <ul aria-live="polite">{mcleodResults.map((item, index) => (
          <li key={index}>{[item.container, item.orderId && `SCM order ${item.orderId}`, item.file, item.status].filter(Boolean).join(" · ")}</li>
        ))}</ul>}
        {mcleodCheck && <div role="status">
          <p><strong>{mcleodCheck.container}</strong> {mcleodCheck.orderId ? `· SCM order ${mcleodCheck.orderId} · ` : "· "}{mcleodCheck.status}</p>
          {mcleodCheck.orderId && <p>Movement {mcleodCheck.movementId ?? "could not be verified"}
            {mcleodCheck.movementId && !mcleodCheck.movementImagesAvailable ? " · Movement images unavailable" : ""}</p>}
          <details open><summary>Existing McLeod documents</summary>
            {mcleodCheck.existingImages.length > 0 ? <ul>{mcleodCheck.existingImages.map(image => (
              <li key={image.scope + image.id}>{[image.scope, image.type, image.description, image.scanDate].filter(Boolean).join(" · ")}</li>
            ))}</ul> : <p>{mcleodCheck.status === "Verified order" ? "No existing documents returned." : "Existing documents unavailable."}</p>}
          </details>
          {mcleodCheck.documentTypes.length > 0 && <details><summary>Available McLeod document types</summary>
            <ul>{mcleodCheck.documentTypes.map(type => <li key={type.id}>{type.description} ({type.id})</li>)}</ul>
          </details>}
        </div>}
        {!e2openDocuments.containers.length && <p>No saved container numbers to check.</p>}
      </div>}
    </PlatformPanel>}
    <PlatformPanel><div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <strong>{booking.requested_bales} requested bales</strong><span>{booking.planned_containers ?? "—"} planned containers</span>
      <span>{complete} of {activeContainers.length} equipment rows complete</span><span>Customer ref {booking.customer_reference || "—"}</span><strong style={{ color: lines.some((line) => line.line_status === "active" && line.load_source === "warehouse" && line.warehouse_bales < line.mark_requested_total) ? "#fca5a5" : "#86efac" }}>{new Set(lines.filter((line) => line.line_status === "active" && line.load_source === "warehouse" && line.warehouse_bales < line.mark_requested_total).map((line) => line.mark)).size} missing marks</strong><span className="booking-status">{booking.status === "draft" ? "Active" : booking.status === "cancelled" ? "Deleted" : "Archived"}</span>
    </div>
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", marginTop: 18 }}>
      <span><strong>ERD</strong> {formatBookingDate(booking.erd)}</span>
      <span><strong>Doc cutoff</strong> {formatBookingDate(booking.doc_cutoff, booking.doc_cutoff_has_time !== false)}</span>
      <span><strong>Cutoff</strong> {formatBookingDate(booking.cutoff, booking.cutoff_has_time !== false)}</span>
      <span><strong>Return location</strong> {bookingReturnLocationLabel(booking.return_location, booking.return_location_code)}{booking.return_location_code ? ` · ${booking.return_location_code}` : ""}</span>
      <span><strong>Steamship line</strong> {booking.steamship_line || "—"}</span>
      {booking.vessel ? <span><strong>Vessel</strong> {booking.vessel}</span> : null}
    </div>
    <input ref={requestInput} type="file" accept=".xlsx,.xlsb" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importDetails(file); }} />
    {editingDetails ? <form onSubmit={(event) => void saveDetails(event)} style={{ marginTop: 16 }}>
      {importedDateNotes.length ? <p style={{ color: "#fbbf24", fontSize: 12 }}>{importedDateNotes.join(" · ")}</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {locationOptions.length > 1 && <label>Warehouse location<select style={input} value={details.destinationSiteCode}
          onChange={event => setDetails(current => ({ ...current, destinationSiteCode: event.target.value }))}>
          {locationOptions.map(site => <option key={site.siteCode} value={site.siteCode}>{site.siteName}</option>)}
        </select></label>}
        <label>SCM File #<input style={input} maxLength={80} value={details.scmFileNumber} onChange={(event) => setDetails((current) => ({ ...current, scmFileNumber: event.target.value }))} /></label>
        <label>ERD<input type="date" style={input} value={details.erd} onChange={(event) => setDetails((current) => ({ ...current, erd: event.target.value }))} /></label>
        <CutoffInput label="Doc cutoff" value={details.docCutoff} onChange={(value) => setDetails((current) => ({ ...current, docCutoff: value }))} />
        <CutoffInput label="Cutoff" value={details.cutoff} onChange={(value) => setDetails((current) => ({ ...current, cutoff: value }))} />
        <label>Return location<input style={input} maxLength={300} value={details.returnLocation} onChange={event => setDetails(current => ({ ...current, returnLocation: event.target.value }))} /></label>
        <label>Steamship line (SSL)<input style={input} maxLength={200} value={details.steamshipLine} onChange={event => setDetails(current => ({ ...current, steamshipLine: event.target.value }))} /></label>
        <label>Vessel<input style={input} maxLength={200} value={details.vessel} onChange={(event) => setDetails((current) => ({ ...current, vessel: event.target.value }))} /></label>
      </div><p style={{ color: "#94a3b8", fontSize: 12 }}>Times are optional and local to {booking.site_name}.</p>
      <div style={{ display: "flex", gap: 8 }}><button style={button} type="submit" disabled={!canWrite || Boolean(working)}>{working === "details" ? "Saving…" : "Save details"}</button>
        <button style={button} type="button" disabled={!canWrite || Boolean(working)} onClick={() => { setEditingDetails(false); setMessage(""); }}>Cancel</button></div>
    </form> : null}
    {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}{message && <p role="status" style={{ color: "#86efac" }}>{message}</p>}</PlatformPanel>

    {lines.some((line) => line.source_arrivals?.length && line.line_status !== "cancelled") && <PlatformPanel><div role="alert" style={{ color: "#fde68a" }}>
      <strong>Source loads arrived at a warehouse — review required</strong>
      {lines.filter((line) => line.source_arrivals?.length && line.line_status !== "cancelled").map((line) => <p key={line.id}>{line.mark} · {line.source_arrivals.map((arrival) => arrival.arrival_site_name).join(", ")} · <button type="button" style={button} disabled={!canWrite || Boolean(working)} onClick={() => chooseMarkAction(line, "warehouse")}>Convert to warehouse load</button> <button type="button" style={button} disabled={!canWrite || Boolean(working)} onClick={() => chooseMarkAction(line, "keep_source")}>Keep as source load</button></p>)}
    </div></PlatformPanel>}
    <PlatformPanel><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div><h2 style={{ marginBottom: 4 }}>Outbound load plan</h2><p style={{ marginTop: 0, color: "#94a3b8" }}>Badges show receiving status. Green bale counts match the requested quantity.</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input aria-label="Search booking" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedContainers(new Set()); }}
        placeholder="Search marks or equipment" style={{ ...input, width: 260 }} />
        {isAdmin && !carrierError && <CarrierRateManager key={carrierEndpoint} rates={carrierRates} endpoint={carrierEndpoint} onSaved={rate =>
      setCarrierRates(current => [...current.filter(item => item.id !== rate.id), rate])} />}
        <button type="button" style={button} disabled={!canWrite || Boolean(working)} onClick={() => { setMarkError(""); setNewMark({ requestId: crypto.randomUUID(), mark: "", bales: "", shippingOrder: "" }); }}>+ Add mark to booking</button>
        <button type="button" style={button} disabled={!canWrite || Boolean(working) || rollMode} onClick={() => { setSelectedContainers(new Set()); setRollMode(true); setSearch(""); setError(""); }}>Split / roll marks</button></div>
    </div>

    {rollMode ? <div style={{ margin: "14px 0", padding: 14, borderRadius: 12, border: "1px solid rgba(99,102,241,.45)", background: "rgba(79,70,229,.1)" }}>
      <strong>Split / roll {selectedLines.size} selected mark{selectedLines.size === 1 ? "" : "s"}</strong>
      <p style={{ color: "#cbd5e1", fontSize: 13, margin: "8px 0" }}>Select marks below, enter the destination booking, then move them. Adjust each selected quantity for a partial split. Marks with equipment entered must have that equipment cleared first.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, margin: "10px 0" }}>
        {[...selectedLines].map((lineId) => { const line = lineById.get(lineId); return line ? <label key={lineId} style={{ color: "#cbd5e1", fontSize: 12 }}>{line.mark} bales
          <input type="number" min={1} max={line.requested_bales} style={input} value={rollQuantities[lineId] ?? line.requested_bales}
            onChange={(event) => setRollQuantities((current) => ({ ...current, [lineId]: event.target.value }))} /></label> : null; })}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input aria-label="Destination booking number" style={{ ...input, width: 240 }} value={rollBooking}
        onChange={(event) => setRollBooking(event.target.value.toUpperCase())} placeholder="Destination booking #" />
        <button type="button" style={button} disabled={!canWrite || Boolean(working) || !rollBooking.trim() || selectedLines.size === 0} onClick={() => void rollSelected()}>
          {working === "bulk-roll" ? "Moving marks…" : "Move selected marks"}</button>
        <button type="button" style={button} disabled={!canWrite || Boolean(working)} onClick={() => { setRollMode(false); setSelectedLines(new Set()); setRollQuantities({}); setRollBooking(""); }}>Cancel split / roll</button></div>
    </div> : null}

    {canManage && <div style={{ marginBottom: 8 }}><Link href="/warehouse/rates">Customer billing rates</Link></div>}
    {canManage && carrierError && <p role="alert">{carrierError}</p>}
    {selectedRows.length > 0 && <CarrierBatchToolbar billing={customerBilling} rates={carrierRates} plans={selectedRows.map(row => row.carrier_plan)}
      disabled={Boolean(working) || bulkSaving} onApply={applyCarrierBatch} onClear={() => setSelectedContainers(new Set())} />}
    <div style={{ overflowX: "auto" }}><table className="carrier-load-grid" style={{ width: "100%", minWidth: canManage ? 1250 : 1020, borderCollapse: "collapse" }}><thead><tr>
      {selectionEnabled && <th style={th} scope="col"><input type="checkbox" aria-label="Select all visible containers"
        checked={selectableRows.length > 0 && selectedRows.length === selectableRows.length}
        disabled={!selectableRows.length || Boolean(working) || bulkSaving}
        onChange={event => toggleContainers(selectableRows.map(row => row.id), event.target.checked)} /></th>}
      {[...(rollMode ? ['Select'] : []), '#', 'Mark', 'Bales', 'Container number', 'Seal number', 'Chassis number', 'Notes', ...(canManage ? ['Carrier / charges', 'All-in pay', 'All-in bill'] : []), 'Actions'].map((label) => <th key={label} style={th}>{label}</th>)}
    </tr></thead><tbody>{visibleContainers.map((row) => {
      if (row.split_transfer_id) return <tr key={row.id} style={{ background: "rgba(71,85,105,.12)", color: "#94a3b8" }}>
        {(rollMode || selectionEnabled) && <td style={td} />}<td style={td}>{row.sequence_no}</td>
        <td style={td}><strong>{row.split?.mark ?? "Moved mark"}</strong><small style={{ display: "block", marginTop: 3 }}>Split to booking {row.split?.target_booking_number ?? "—"}</small></td>
        <td style={td}>{row.split?.bales ?? "—"}</td>
        <td style={td} colSpan={canManage ? 7 : 4}>{row.split ? <Link style={{ color: "#a5b4fc" }} href={`/warehouse/outbound/${terminal}/${siteCode}/${row.split.target_booking_id}?returnTo=${encodeURIComponent(backHref)}`}>View booking {row.split.target_booking_number}</Link> : "Transferred"}</td>
        <td style={{ ...td, fontSize: 12, fontWeight: 600 }}>Locked</td>
      </tr>;
      const draft = drafts[row.id] ?? { bookingLineId: "", containerNumber: "", sealNumber: "", chassisNumber: "", notes: "" };
      const line = row.booking_line_id ? lineById.get(row.booking_line_id) : null;
      const locked = line?.line_status === "on_hold" || line?.line_status === "cancelled";
      const saved = draft.bookingLineId === (row.booking_line_id ?? "") && draft.containerNumber === (row.container_number ?? "") && draft.sealNumber === (row.seal_number ?? "") &&
        draft.chassisNumber === (row.chassis_number ?? "") && draft.notes === (row.notes ?? "");
      const hasEquipment = Boolean(draft.containerNumber || draft.sealNumber || draft.chassisNumber || draft.notes || row.carrier_plan);
      const totals = row.carrier_plan ? carrierPlanTotals(row.carrier_plan, customerBilling) : null;
      return <tr key={row.id} data-selected={selectionEnabled && selectedContainers.has(row.id)} style={{ background: line && line.available_bales > 0 ? "rgba(34,197,94,.035)" : undefined }}>
        {selectionEnabled && <td style={td}><input type="checkbox" aria-label={`Select container ${row.container_number ?? row.sequence_no}`}
          checked={selectableIds.has(row.id) && selectedContainers.has(row.id)} disabled={!selectableIds.has(row.id) || Boolean(working) || bulkSaving}
          onChange={event => toggleContainers([row.id], event.target.checked)} /></td>}
        {rollMode && <td style={td}>{line ? <input type="checkbox" aria-label={`Select ${line.mark}`} checked={selectedLines.has(line.id)} disabled={hasEquipment || locked}
          title={hasEquipment ? "Clear equipment and carrier details before rolling this mark" : "Select mark for split or rollover"} onChange={() => toggleLine(line)} /> : null}</td>}
        <td style={td}><strong>{row.sequence_no}</strong></td>
        <td style={td}>{line ? <><strong style={{ fontSize: 16 }}>{line.mark}</strong><div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>{bookingMarkBadges({ ...line, active_line_numbers: activeLine?.bookingId === id ? activeLine.numbers[line.mark.toUpperCase()] : undefined }).map((badge) => <span key={badge.label} title={badge.title} style={{ color: badge.color, background: badge.background, border: "none", borderRadius: 20, padding: "2px 7px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{badge.label}</span>)}</div>{line.status_note && <small style={{ display: "block", color: "#94a3b8", marginTop: 4 }}>{line.status_note}</small>}{line.load_source === "source_load" && <small style={{ display: "block", color: "#94a3b8", marginTop: 4 }}>{line.source_warehouse}</small>}</> : <span style={{ color: "#94a3b8" }}>Extra container</span>}</td>
        <td style={td}>{line && (line.load_source === "source_load" || locked) ? <strong style={{ color: "#94a3b8" }}>{line.requested_bales}</strong> : line ? <strong title={bookingBaleDisplay(line).title} style={{ color: bookingBaleDisplay(line).color, whiteSpace: "nowrap" }}>{bookingBaleDisplay(line).text}</strong> : "—"}</td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} number`} disabled={!canWrite || locked || Boolean(working)} style={input} value={draft.containerNumber} onChange={(e) => change(row, "containerNumber", e.target.value)} placeholder="ABCD1234567" /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} seal`} disabled={!canWrite || locked || Boolean(working)} style={input} value={draft.sealNumber} onChange={(e) => change(row, "sealNumber", e.target.value)} placeholder="Seal #" /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} chassis`} disabled={!canWrite || locked || Boolean(working)} style={input} value={draft.chassisNumber} onChange={(e) => change(row, "chassisNumber", e.target.value)} placeholder={terminal === "SAV" ? "SCMI" : "Chassis #"} /></td>
        <td style={td}><input aria-label={`Container ${row.sequence_no} notes`} disabled={!canWrite || locked || Boolean(working)} style={input} value={draft.notes} onChange={(e) => change(row, "notes", e.target.value)} placeholder="Optional" /></td>
        {canManage && <>
          <td style={td}><CarrierSummary plan={row.carrier_plan} /></td>
          <td style={td} className="carrier-total">{totals ? `$${(totals.pay / 100).toFixed(2)}` : "—"}</td>
          <td style={td} className="carrier-total">{totals?.bill != null ? `$${(totals.bill / 100).toFixed(2)}` : totals ? "Rate unavailable" : "—"}</td>
        </>}
        <td style={{ ...td, color: working === row.id ? "#fbbf24" : saved && hasEquipment ? "#86efac" : "#94a3b8", fontSize: 12, fontWeight: 600 }}>
          {locked ? "Locked" : working === row.id ? "Saving…" : !saved ? "Unsaved changes" : hasEquipment ? "Saved" : "No equipment entered"}
          {canWrite && !locked && <div style={{ marginTop: 6 }}>
            <button type="button" style={{ ...button, padding: "5px 8px", fontSize: 11 }}
              aria-label={`Save container ${row.sequence_no}`} disabled={saved || Boolean(working)}
              onClick={() => void save(row, draft)}>Save</button>
          </div>}
          {canManage && (row.container_number || row.booking_line_id) && <button type="button" className="carrier-row-details" disabled={Boolean(working) || bulkSaving}
            onClick={() => setDetailId(row.id)}>Details</button>}
          {line && line.line_status !== "cancelled" && <details className="booking-mark-actions" style={{ marginTop: 8 }}><summary>Mark actions ▾</summary><div>
            <button type="button" style={{ ...button, padding: "5px 7px", fontSize: 11 }} disabled={!canWrite || Boolean(working)} onClick={() => chooseMarkAction(line, locked ? "resume" : "hold")}>{locked ? "Resume" : "Put on hold"}</button>
            <button type="button" style={{ ...button, padding: "5px 7px", fontSize: 11, color: "#94a3b8" }} disabled={!canWrite || Boolean(working)} onClick={() => chooseMarkAction(line, "cancel")}>Cancel mark</button>
            {line.load_source === "source_load" && <button type="button" style={{ ...button, padding: "5px 7px", fontSize: 11 }} disabled={!canWrite || Boolean(working)} onClick={() => chooseMarkAction(line, "warehouse")}>Convert to warehouse load</button>}
          </div></details>}
        </td></tr>;
    })}</tbody></table></div>
    </PlatformPanel>
    {detailRow && <dialog ref={detailDialog} className="carrier-details-dialog" aria-labelledby="carrier-details-title" onClose={() => setDetailId("")}>
      <div className="carrier-dialog-heading">
        <h2 id="carrier-details-title">{detailRow.container_number || detailLine?.mark || "Container details"}</h2>
        <form method="dialog"><button type="submit">Close</button></form>
      </div>
      <h3>Carrier and charges</h3>
      {detailDraft && <CarrierEditor key={JSON.stringify(detailRow.carrier_plan)} plan={detailRow.carrier_plan} billing={customerBilling} rates={carrierRates}
        sequence={detailRow.sequence_no} disabled={!canWrite || Boolean(working) || Boolean(detailLine && detailLine.line_status !== "active")}
        onSave={selection => save(detailRow, detailDraft, selection)} />}
      {error && <p role="alert">{error}</p>}
      {orderLookup && detailRow.container_number && <BookingOrderLookup key={detailRow.container_number} endpoint={`/api/warehouse/outbound/bookings/${id}/mcleod-order?containerId=${detailRow.id}`} />}
      {hasletPilot && canWrite && detailRow.container_number && detailLine?.line_status === "active" && detailLine.load_source === "warehouse" &&
        <DallasOrderPilot key={detailRow.updated_at} endpoint={`/api/warehouse/outbound/bookings/${id}/dallas-pilot`} containerId={detailRow.id} mark={detailLine.mark} />}
    </dialog>}
    {markAction && <div role="dialog" aria-modal="true" aria-labelledby="mark-action-title" style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.8)", zIndex: 50, display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={(event) => void changeMark(event)} style={{ background: "#0f172a", border: "1px solid #475569", borderRadius: 12, padding: 24, width: "100%", maxWidth: 480, boxSizing: "border-box" }}>
        <h2 id="mark-action-title">{markAction.action === "hold" ? "Put on hold" : markAction.action === "resume" ? "Resume mark" : markAction.action === "cancel" ? "Cancel mark from booking" : markAction.action === "warehouse" ? "Convert to warehouse load" : "Keep as source load"}: {markAction.line.mark}</h2>
        <p style={{ color: "#cbd5e1", fontSize: 13 }}>{markAction.action === "hold" ? "Keep this mark on ice. Its equipment and split actions are locked until you resume it." : markAction.action === "cancel" ? "Remove this mark from the booking’s requested total and active load plan. Its history and saved equipment remain visible in a locked row below." : markAction.action === "warehouse" ? `Plan this mark through ${booking.site_name}. This does not mark it as received; normal check-in and warehouse receiving still apply.` : markAction.action === "keep_source" ? "Acknowledge the unexpected arrival and explain why the direct-pickup plan still applies." : "Return this mark to the active plan."}</p>
        <label>Note {markAction.action === "keep_source" ? "(required)" : "(optional)"}<textarea aria-label="Mark action note" required={markAction.action === "keep_source"} maxLength={500} style={input} value={markAction.note} onChange={(event) => setMarkAction((current) => current && { ...current, note: event.target.value })} /></label>
        {actionError && <p role="alert" style={{ color: "#fca5a5" }}>{actionError}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}><button style={button} type="submit" disabled={!canWrite || Boolean(working)}>{working === "mark-action" ? "Saving…" : "Confirm change"}</button><button style={button} type="button" disabled={!canWrite || Boolean(working)} onClick={() => setMarkAction(null)}>Back</button></div>
      </form>
    </div>}
    {newMark && <div role="dialog" aria-modal="true" aria-labelledby="add-mark-title" style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.8)", zIndex: 50, display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={(event) => void addMark(event)} style={{ background: "#0f172a", border: "1px solid #475569", borderRadius: 12, padding: 24, width: "100%", maxWidth: 460, boxSizing: "border-box" }}>
        <h2 id="add-mark-title" style={{ marginTop: 0 }}>Add mark to booking</h2>
        <p style={{ color: "#94a3b8", fontSize: 13 }}>Add the mark and requested bales to booking {booking.booking_number}. Container details can be entered on its row afterward.</p>
        {markError && <p role="alert" style={{ color: "#fca5a5" }}>{markError}</p>}
        <div style={{ display: "grid", gap: 14 }}>
          <label>Mark<input autoFocus required maxLength={80} value={newMark.mark} disabled={!canWrite || Boolean(working)} style={input} onChange={(event) => setNewMark((current) => current && { ...current, mark: event.target.value.toUpperCase() })} /></label>
          <label>Requested bales<input required type="number" min={1} max={1000000} step={1} value={newMark.bales} disabled={!canWrite || Boolean(working)} style={input} onChange={(event) => setNewMark((current) => current && { ...current, bales: event.target.value })} /></label>
          <label>Shipping order (optional)<input maxLength={200} value={newMark.shippingOrder} disabled={!canWrite || Boolean(working)} style={input} onChange={(event) => setNewMark((current) => current && { ...current, shippingOrder: event.target.value })} /></label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}><button type="submit" disabled={!canWrite || Boolean(working)} style={button}>{working === "add-mark" ? "Adding mark…" : "Add mark"}</button>
          <button type="button" disabled={!canWrite || Boolean(working)} onClick={() => setNewMark(null)} style={button}>Cancel</button></div>
      </form>
    </div>}
  </main>;
}
