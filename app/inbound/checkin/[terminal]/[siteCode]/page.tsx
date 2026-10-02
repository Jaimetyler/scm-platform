"use client";

import CompletedOrderNotice from "@/components/warehouse/CompletedOrderNotice";
import type { McleodCompletion } from "@/lib/inbound/checkin/mcleod-order-id";

import SourceLoadAlerts from "@/components/warehouse/SourceLoadAlerts";

import Link from "next/link";
import { useWarehouseViewState } from "@/components/warehouse/useWarehouseViewState";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import "@/components/warehouse/domestic-tables.css";
import ScmOrderBadge from "@/components/warehouse/ScmOrderBadge";
import PaperworkPhotoLink from "@/components/warehouse/PaperworkPhotoLink";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";
import { warehouseDate } from "@/lib/inbound/checkin/geofence";
import { isReadyCheckin, usesMcleodCheckin, isCompleteCheckin } from "@/lib/inbound/checkin/ready";
import { CUSTOMER_XREF } from "@/lib/mcleod/inbound/xref";

import { cottonShortage, type ShortageFields } from "@/lib/inbound/checkin/shortage";
import ShortageNotice, { type ShortageAction } from "@/components/warehouse/ShortageNotice";

type CheckinRow = ShortageFields & {
  id: string;
  client_id?: string;
  created_at: string;
  checked_in_at?: string | null;
  verified_at?: string | null;
  identity_corrected_at?: string | null;
  updated_at: string;
  last_saved_at: string;
  terminal: string;
  site_code: string;
  site_name: string;
  sub_location: string;
  received_date: string | null;
  mark: string | null;
  shipper: string | null;
  bol_bc: number | null;
  bale_count: number | null;
  warehouse_location: string | null;
  equipment_type: "V" | "F" | null;
  verified: boolean;
  comment_1: string | null;
  comment_2: string | null;
  draft_status: "draft" | "checked_in" | "ready" | "processing" | "processed" | "outside_carrier" | "failed" | "delivery_blocked";
  processed_at: string | null;
  processing_error?: string | null;
  matched_order_id?: string | null;
  checkin_source?: "staff" | "driver_qr";
  driver_name?: string | null;
  driver_phone?: string | null;
  trucking_company?: string | null;
  gate_location_verified_at?: string | null;
  has_bol_photo?: boolean;
  movement_direction?: "pickup" | "delivery" | null;
  material_type?: "cotton" | "lumber" | "other" | null;
  reference_number?: string | null;
  destination?: string | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

type RowUiState = {
  saveState: SaveState;
  message: string;
};

type CottonMatch = { orderId: string; mark: string; customer: string; bolBC: number | null;
  carrierName: string; carrierCode: string; orderDate: string; orderStatus: string;
  driverName: string; driverPhone: string; completion?: McleodCompletion | null };
function sameMark(a: string, b: string) {
  return a.toUpperCase().replace(/[^A-Z0-9]/g, "") === b.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

type ColumnKey =
  | "received_date"
  | "mark"
  | "shipper"
  | "bol_bc"
  | "bale_count"
  | "equipment_type"
  | "comment_1"
  | "warehouse_location";

const COLUMN_ORDER: ColumnKey[] = [
  "received_date",
  "mark",
  "shipper",
  "bol_bc",
  "bale_count",
  "equipment_type",
  "comment_1",
  "warehouse_location",
];

function createEmptyUiState(): RowUiState {
  return { saveState: "idle", message: "" };
}

function normalizeCustomerOption(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

const CHECKIN_CUSTOMERS = Array.from(
  new Set(
    CUSTOMER_XREF.map((item) =>
      normalizeCustomerOption(
        (item as { canonicalCustomer?: string | null }).canonicalCustomer
      )
    ).filter(Boolean)
  )
).sort((a, b) => a.localeCompare(b));

function rowTone(row: CheckinRow): React.CSSProperties {
  if (cottonShortage(row)) return { background: "rgba(180,83,9,.09)" };
  if (row.draft_status === "processed") {
    return { background: "rgba(59,130,246,0.03)" };
  }

  if (row.draft_status === "ready") {
    return { background: "rgba(16,185,129,0.03)" };
  }

  if (row.draft_status === "outside_carrier") {
    return { background: "rgba(168,85,247,0.07)" };
  }

  if (row.draft_status === "failed") return { background: "rgba(239,68,68,0.06)" };

  return {};
}

function rowDotStyle(row: CheckinRow): React.CSSProperties {
  const gateOnly = row.checkin_source === "driver_qr" && !usesMcleodCheckin(row);
  return {
    width: 10,
    height: 10,
    borderRadius: "50%",
    margin: 0,
    background:
      gateOnly
        ? "#06b6d4"
        : row.draft_status === "processed"
        ? "#3b82f6"
        : row.draft_status === "outside_carrier"
        ? "#a855f7"
        : row.draft_status === "failed"
        ? "#ef4444"
        : row.draft_status === "processing"
        ? "#eab308"
        : row.draft_status === "ready"
        ? "#10b981"
        : "#64748b",
    boxShadow:
      row.draft_status === "processed"
        ? "0 0 0 3px rgba(59,130,246,0.14)"
        : row.draft_status === "ready"
        ? "0 0 0 3px rgba(16,185,129,0.14)"
        : "0 0 0 3px rgba(100,116,139,0.12)",
  };
}

function willProcess(row: CheckinRow) {
  return isReadyCheckin(row);
}

function isClosedRow(row: CheckinRow) {
  return row.draft_status === "processed" || row.draft_status === "outside_carrier" ||
    row.draft_status === "processing";
}

function formatArrivalTime(row: CheckinRow): string {
  if (!row.checked_in_at) return "";

  return new Date(row.checked_in_at).toLocaleTimeString("en-US", {
    timeZone: row.terminal === "HOU" ? "America/Chicago" : "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

function orderCheckinRows(rows: CheckinRow[]): CheckinRow[] {
  const saved = rows.filter((row) => !row.id.startsWith("local-"));
  const blank = rows.filter((row) => row.id.startsWith("local-"));
  saved.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return [...saved, ...blank];
}

export default function SiteCheckinPage() {
  const params = useParams<{ terminal: string; siteCode: string }>();

  const terminalSlug = String(params?.terminal ?? "");
  const siteCode = String(params?.siteCode ?? "");

  const site = useMemo(
    () => getCheckinSite(terminalSlug, siteCode),
    [terminalSlug, siteCode]
  );

  const [rows, setRows] = useState<CheckinRow[]>([]);
  const [viewCarryover, setViewCarryover, viewReady] = useWarehouseViewState("carryover", false);
  const [carryover, setCarryover] = useState({ count: 0, missingLocation: 0, missingBales: 0 });
  const dayRef = useRef("");
  const [rowUi, setRowUi] = useState<Record<string, RowUiState>>({});
  const [loading, setLoading] = useState(true);
  const [editingProcessedIds, setEditingProcessedIds] = useState<Set<string>>(new Set());
  const [dispatcherLookupIds, setDispatcherLookupIds] = useState<Set<string>>(new Set());
  const [cottonMatches, setCottonMatches] = useState<Record<string, CottonMatch[]>>({});
  const [cottonSearching, setCottonSearching] = useState<Record<string, boolean>>({});
  const [cottonWarnings, setCottonWarnings] = useState<Record<string, string>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [newCheckin, setNewCheckin] = useState<CheckinRow | null>(null);
  const [newMatches, setNewMatches] = useState<CottonMatch[]>([]);
  const [newSearching, setNewSearching] = useState(false);
  const [newError, setNewError] = useState("");
  const [newSaving, setNewSaving] = useState(false);
  const lookupKeysRef = useRef<Record<string, string>>({});
  const lookupTimersRef = useRef<Record<string, number>>({});

  const saveTimersRef = useRef<Record<string, number>>({});
  const createInFlightRef = useRef<Set<string>>(new Set());
  const saveInFlightRef = useRef<Set<string>>(new Set());
  const pendingSaveRef = useRef<Set<string>>(new Set());
  const editRevisionRef = useRef<Record<string, number>>({});
  const rowsRef = useRef<CheckinRow[]>([]);
  const editSnapshotsRef = useRef<Record<string, CheckinRow>>({});
  const cellRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => { rowsRef.current = rows; }, [rows]);

  useEffect(() => {
    for (const row of rows) {
      if (viewCarryover || isClosedRow(row) || row.matched_order_id || row.checkin_source === "driver_qr") continue;
      const mark = (row.mark ?? "").trim().toUpperCase();
      const key = `${mark}|${(row.shipper ?? "").trim().toUpperCase()}`;
      if (lookupKeysRef.current[row.id] === key) continue;
      if (lookupTimersRef.current[row.id]) window.clearTimeout(lookupTimersRef.current[row.id]);
      lookupKeysRef.current[row.id] = key;
      setCottonMatches((current) => { const next = { ...current }; delete next[row.id]; return next; });
      setCottonWarnings((current) => { const next = { ...current }; delete next[row.id]; return next; });
      if (!site || mark.length < 3) {
        setCottonSearching((current) => ({ ...current, [row.id]: false }));
        continue;
      }
      setCottonSearching((current) => ({ ...current, [row.id]: true }));
      lookupTimersRef.current[row.id] = window.setTimeout(async () => {
        delete lookupTimersRef.current[row.id];
        try {
          const query = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode, mark, customer: row.shipper ?? "" });
          const response = await fetch(`/api/inbound/checkin/cotton-match?${query}`, { cache: "no-store" });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || "McLeod lookup failed");
          if (lookupKeysRef.current[row.id] !== key) return;
          const found = result.matches as CottonMatch[];
          setCottonMatches((current) => ({ ...current, [row.id]: found }));
          if (result.incomplete) setCottonWarnings((current) => ({ ...current, [row.id]: result.warning || "McLeod search incomplete" }));
          if (!result.incomplete && found.length === 1 && !found[0].completion && found[0].customer) {
            const match = found[0];
            const latest = rowsRef.current.find((item) => item.id === row.id);
            if (latest && (latest.mark ?? "").trim().toUpperCase() === mark &&
              (latest.shipper ?? "").trim().toUpperCase() === (row.shipper ?? "").trim().toUpperCase()) {
              // Keep the typed mark: an embedded reference may not be the whole consignee reference.
              // Never populate unloaded bales or the final location from the order.
              const updated = applyRowUpdate(row.id, (current) => ({ ...current,
                shipper: current.shipper || match.customer,
                bol_bc: current.bol_bc || match.bolBC,
                matched_order_id: sameMark(current.mark ?? "", match.mark) &&
                  (!current.bol_bc || !match.bolBC || current.bol_bc <= match.bolBC)
                  ? match.orderId : current.matched_order_id,
              }));
              if (updated) queueSaveRow(updated);
            }
          }
        } catch (error) {
          if (lookupKeysRef.current[row.id] === key) setRowUiState(row.id, {
            saveState: "error", message: error instanceof Error ? error.message : "McLeod lookup failed",
          });
        } finally {
          if (lookupKeysRef.current[row.id] === key) setCottonSearching((current) => ({ ...current, [row.id]: false }));
        }
      }, 650);
    }
    // Only changing the mark starts a new lookup; row edits may change other fields while searching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, site, viewCarryover]);
  useEffect(() => () => { Object.values(lookupTimersRef.current).forEach(window.clearTimeout); }, []);

  function isReadOnlyRow(row: CheckinRow) {
    return row.draft_status === "delivery_blocked" || isClosedRow(row) &&
      !(row.draft_status === "processed" && editingProcessedIds.has(row.id) &&
        rowUi[row.id]?.saveState !== "saving");
  }

  function blankRow(): CheckinRow {
    return {
      id: `local-${crypto.randomUUID()}`, created_at: "", updated_at: "", last_saved_at: "",
      terminal: site!.terminal, site_code: site!.siteCode, site_name: site!.siteName,
      sub_location: site!.subLocations[0] ?? "MAIN", received_date: warehouseDate(new Date(), site!.terminal),
      mark: null, shipper: null, bol_bc: null, bale_count: null, warehouse_location: null,
      equipment_type: site!.terminal === "SAV" ? "V" : null, verified: false,
      comment_1: null, comment_2: null, draft_status: "draft", processed_at: null,
    };
  }

  useEffect(() => {
    if (!site || !newCheckin || newCheckin.matched_order_id) return;
    const mark = (newCheckin.mark ?? "").trim().toUpperCase();
    if (mark.length < 3) { setNewMatches([]); setNewSearching(false); return; }
    let cancelled = false;
    setNewSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode,
          mark, customer: newCheckin.shipper ?? "" });
        const response = await fetch(`/api/inbound/checkin/cotton-match?${query}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "McLeod lookup failed");
        if (cancelled) return;
        const found = result.matches as CottonMatch[];
        setNewMatches(found);
        setNewError(result.incomplete ? result.warning || "McLeod search incomplete; verify manually." : "");
        if (!result.incomplete && found.length === 1 && !found[0].completion && sameMark(mark, found[0].mark) &&
            (!newCheckin.shipper || normalizeCustomerOption(newCheckin.shipper) === normalizeCustomerOption(found[0].customer))) {
          const match = found[0];
          setNewCheckin((current) => current && current.id === newCheckin.id && current.mark === newCheckin.mark
            ? { ...current, shipper: current.shipper || match.customer,
              driver_name: current.driver_name || match.driverName, driver_phone: current.driver_phone || match.driverPhone,
              trucking_company: match.carrierName || current.trucking_company,
              bol_bc: current.bol_bc || match.bolBC, matched_order_id: match.orderId } : current);
        }
      } catch (error) {
        if (!cancelled) setNewError(error instanceof Error ? error.message : "McLeod lookup failed");
      } finally {
        if (!cancelled) setNewSearching(false);
      }
    }, 650);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [site, newCheckin?.id, newCheckin?.mark, newCheckin?.shipper, newCheckin?.matched_order_id]);

  async function saveNewCheckin() {
    if (!site || !newCheckin || newSaving || newSearching) return;
    if (newMatches.length > 0 && newMatches.every((match) => match.completion)) {
      setNewError("These orders are already closed in McLeod. Verify the mark with warehouse staff.");
      return;
    }
    if (!newCheckin.mark?.trim() || !newCheckin.shipper?.trim() || !newCheckin.bol_bc) {
      setNewError("Enter the mark, customer, and BOL bale count.");
      return;
    }
    setNewSaving(true);
    setNewError("");
    try {
      const response = await fetch("/api/inbound/checkin/rows", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: newCheckin.id.slice(6), terminal: site.terminal, siteCode: site.siteCode, siteName: site.siteName,
          subLocation: newCheckin.sub_location, receivedDate: newCheckin.received_date,
          mark: newCheckin.mark, shipper: newCheckin.shipper, bolBC: newCheckin.bol_bc,
          equipmentType: newCheckin.equipment_type, comment1: newCheckin.comment_1,
          driverName: newCheckin.driver_name, driverPhone: newCheckin.driver_phone,
          truckingCompany: newCheckin.trucking_company,
          matchedOrderId: newCheckin.matched_order_id,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Check-in failed");
      setRows((current) => orderCheckinRows([...current.filter((row) => row.id !== result.row.id), result.row]));
      setNewCheckin(null);
      setNewMatches([]);
      void loadRows();
    } catch (error) {
      setNewError(error instanceof Error ? error.message : "Check-in failed");
    } finally { setNewSaving(false); }
  }

  function makeCellKey(rowIndex: number, column: ColumnKey) {
    return `${rowIndex}:${column}`;
  }

  function registerCellRef(
    rowIndex: number,
    column: ColumnKey,
    el: HTMLElement | null
  ) {
    cellRefs.current[makeCellKey(rowIndex, column)] = el;
  }

  function focusCell(rowIndex: number, column: ColumnKey) {
    const el = cellRefs.current[makeCellKey(rowIndex, column)];
    el?.focus();
  }

  function handleGridKeyDown(
    e: React.KeyboardEvent<HTMLElement>,
    rowIndex: number,
    column: ColumnKey
  ) {
    const colIndex = COLUMN_ORDER.indexOf(column);
    if (colIndex === -1) return;

    const isTextarea = column === "comment_1";

    if (isTextarea && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const nextCol = COLUMN_ORDER[colIndex + 1];
      if (nextCol) {
        focusCell(rowIndex, nextCol);
      } else if (rows[rowIndex + 1]) {
        focusCell(rowIndex + 1, COLUMN_ORDER[0]);
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        const prevCol = COLUMN_ORDER[colIndex - 1];
        if (prevCol) {
          focusCell(rowIndex, prevCol);
        } else if (rows[rowIndex - 1]) {
          focusCell(rowIndex - 1, COLUMN_ORDER[COLUMN_ORDER.length - 1]);
        }
      } else {
        const nextCol = COLUMN_ORDER[colIndex + 1];
        if (nextCol) {
          focusCell(rowIndex, nextCol);
        } else if (rows[rowIndex + 1]) {
          focusCell(rowIndex + 1, COLUMN_ORDER[0]);
        }
      }
      return;
    }

    if (e.key === "ArrowRight") {
      if (isTextarea) return;
      e.preventDefault();
      const nextCol = COLUMN_ORDER[colIndex + 1];
      if (nextCol) focusCell(rowIndex, nextCol);
      return;
    }

    if (e.key === "ArrowLeft") {
      if (isTextarea) return;
      e.preventDefault();
      const prevCol = COLUMN_ORDER[colIndex - 1];
      if (prevCol) focusCell(rowIndex, prevCol);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows[rowIndex + 1]) {
        focusCell(rowIndex + 1, column);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows[rowIndex - 1]) {
        focusCell(rowIndex - 1, column);
      }
    }
  }

  async function loadRows(initial = false) {
    if (!site) return;

    try {
      if (initial) setLoading(true);

      const today = warehouseDate(new Date(), site.terminal);
      const changedDay = dayRef.current !== today;
      dayRef.current = today;

      const params = new URLSearchParams({
        terminal: site.terminal,
        siteCode: site.siteCode,
        date: today,
        materialType: "cotton",
        ...(viewCarryover ? { view: "carryover" } : {}),
      });

      const res = await fetch(`/api/inbound/checkin/rows?${params.toString()}`, {
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to load check-in rows");
      }

      const nextRows = (data.rows ?? []) as CheckinRow[];
      setCarryover({ count: Number(data.carryoverCount ?? 0), missingLocation: Number(data.carryoverMissingLocation ?? 0),
        missingBales: Number(data.carryoverMissingBales ?? 0) });
      setRows((previous) => {
        const pending = changedDay || viewCarryover ? [] : previous.filter((row) => row.id.startsWith("local-"));
        const focusedId = document.activeElement?.closest("tr")?.getAttribute("data-checkin-id");
        const active = new Map((changedDay ? [] : previous).filter((row) =>
          !row.id.startsWith("local-") &&
          (editSnapshotsRef.current[row.id] || row.id === focusedId || saveTimersRef.current[row.id] ||
            rowUi[row.id]?.saveState === "saving" || rowUi[row.id]?.saveState === "error")
        ).map((row) => [row.id, row]));
        return orderCheckinRows([...nextRows.map((row) => active.get(row.id) ?? row), ...pending]);
      });

      const nextUi: Record<string, RowUiState> = {};
      for (const row of nextRows) {
        nextUi[row.id] = createEmptyUiState();
      }
      setRowUi((previous) => ({ ...nextUi, ...previous }));
    } catch (error) {
      if (initial) alert(error instanceof Error ? error.message : "Failed to load check-in rows");
    } finally {
      if (initial) setLoading(false);
    }
  }

  useEffect(() => {
    if (!viewReady) return;
    editSnapshotsRef.current = {};
    setEditingProcessedIds(new Set());
    setRows([]);
    setRowUi({});
    void loadRows(true);
    const interval = window.setInterval(() => {
      void loadRows();
    }, 10000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site?.terminal, site?.siteCode, viewCarryover, viewReady]);

  function setRowUiState(id: string, state: Partial<RowUiState>) {
    setRowUi((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? createEmptyUiState()),
        ...state,
      },
    }));
  }

  function toggleDetails(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function applyRowUpdate(
    id: string,
    updater: (row: CheckinRow) => CheckinRow
  ): CheckinRow | null {
    const current = rowsRef.current.find((row) => row.id === id);
    if (!current) return null;
    const updatedRow = updater(current);
    editRevisionRef.current[id] = (editRevisionRef.current[id] ?? 0) + 1;
    rowsRef.current = rowsRef.current.map((row) => row.id === id ? updatedRow : row);
    setRows((prev) => prev.map((row) => row.id === id ? updatedRow : row));
    return updatedRow;
  }

  async function saveRowSnapshot(row: CheckinRow, action?: ShortageAction) {
    if (!row || row.id.startsWith("local-") || isClosedRow(row)) return;
    if (willProcess(row) &&
        (document.activeElement?.getAttribute("data-checkin-identity") === row.id ||
         document.activeElement?.getAttribute("data-checkin-location") === row.id)) return;
    if (saveInFlightRef.current.has(row.id)) {
      if (action) throw new Error("Wait for this row to finish saving, then try again");
      pendingSaveRef.current.add(row.id);
      return;
    }
    saveInFlightRef.current.add(row.id);
    const revision = editRevisionRef.current[row.id] ?? 0;
    const lockingForProcessing = willProcess(row);
    if (lockingForProcessing) {
      rowsRef.current = rowsRef.current.map((item) => item.id === row.id
        ? { ...item, draft_status: "processing" } : item);
      setRows((previous) => previous.map((item) => item.id === row.id
        ? { ...item, draft_status: "processing" } : item));
    }

    setRowUiState(row.id, { saveState: "saving", message: "" });

    try {
      const res = await fetch(`/api/inbound/checkin/rows/${row.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...action,
          expectedUpdatedAt: row.updated_at,
          terminal: row.terminal,
          siteCode: row.site_code,
          siteName: row.site_name,
          subLocation: row.sub_location,
          receivedDate: row.received_date,
          mark: row.mark,
          shipper: row.shipper,
          bolBC: row.bol_bc,
          baleCount: row.bale_count,
          warehouseLocation: row.warehouse_location,
          equipmentType: row.equipment_type,
          comment1: row.comment_1,
          comment2: row.comment_2,
          matchedOrderId: row.matched_order_id,
          truckingCompany: row.trucking_company,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to save row");
      }

      const savedRow = data.row as CheckinRow;
      const changedDuringSave = (editRevisionRef.current[row.id] ?? 0) !== revision;
      const current = rowsRef.current.find((item) => item.id === row.id);
      const displayRow = changedDuringSave && current && !isClosedRow(savedRow)
        ? { ...savedRow, ...current, draft_status: savedRow.draft_status,
            updated_at: savedRow.updated_at, last_saved_at: savedRow.last_saved_at,
            checked_in_at: savedRow.checked_in_at,
            identity_corrected_at: savedRow.identity_corrected_at,
            verified_at: savedRow.verified_at, processing_error: savedRow.processing_error,
            shortage_acknowledged_at: savedRow.shortage_acknowledged_at, shortage_acknowledged_by: savedRow.shortage_acknowledged_by,
            shortage_expected_bales: savedRow.shortage_expected_bales, shortage_received_bales: savedRow.shortage_received_bales,
            shortage_note: savedRow.shortage_note, customer_notified_at: savedRow.customer_notified_at, customer_notified_by: savedRow.customer_notified_by }
        : { ...savedRow, client_id: current?.client_id };
      rowsRef.current = rowsRef.current.map((item) => item.id === row.id ? displayRow : item);
      setRows((prev) => prev.map((item) => item.id === row.id ? displayRow : item));
      if (changedDuringSave && !isClosedRow(savedRow)) {
        pendingSaveRef.current.add(row.id);
      }
      delete saveTimersRef.current[row.id];
      if (!pendingSaveRef.current.has(row.id)) {
        setRowUiState(row.id, { saveState: "saved", message: "" });
      }
    } catch (error) {
      if (lockingForProcessing) {
        rowsRef.current = rowsRef.current.map((item) => item.id === row.id
          ? { ...item, draft_status: row.draft_status } : item);
        setRows((previous) => previous.map((item) => item.id === row.id
          ? { ...item, draft_status: row.draft_status } : item));
      }
      pendingSaveRef.current.delete(row.id);
      setRowUiState(row.id, {
        saveState: "error",
        message: error instanceof Error ? error.message : "Save failed",
      });
      if (action) throw error;
    } finally {
      saveInFlightRef.current.delete(row.id);
      if (pendingSaveRef.current.delete(row.id)) {
        const latest = rowsRef.current.find((item) => item.id === row.id);
        if (latest && !isClosedRow(latest)) {
          void saveRowSnapshot(latest);
        }
      }
    }
  }

  function queueSaveRow(row: CheckinRow) {
    if (editSnapshotsRef.current[row.id]) return;
    const existing = saveTimersRef.current[row.id];
    if (existing) {
      window.clearTimeout(existing);
    }

    saveTimersRef.current[row.id] = window.setTimeout(() => {
      delete saveTimersRef.current[row.id];
      const latest = rowsRef.current.find((item) => item.id === row.id);
      if (!latest) return;
      // A complete row processes automatically, so wait until the editor
      // leaves fields that may still contain a partial value.
      if (willProcess(latest) &&
          document.activeElement?.getAttribute("data-checkin-identity") === row.id) return;
      if (latest.warehouse_location &&
          document.activeElement?.getAttribute("data-checkin-location") === row.id) return;
      if (!latest.checked_in_at &&
          document.activeElement?.getAttribute("data-checkin-bol") === row.id) return;
      if (latest.id.startsWith("local-")) {
        if (latest.mark?.trim() && latest.shipper?.trim()) void checkIn(latest);
      } else {
        void saveRowSnapshot(latest);
      }
    }, row.id.startsWith("local-") ? 650 : 400);
  }

  function chooseCottonMatch(id: string, match: CottonMatch) {
    if (match.completion) return;
    const updated = applyRowUpdate(id, (row) => ({ ...row,
      mark: match.mark,
      shipper: row.shipper || match.customer,
      bol_bc: row.bol_bc || match.bolBC,
      trucking_company: match.carrierName || row.trucking_company,
      matched_order_id: !row.bol_bc || !match.bolBC || row.bol_bc <= match.bolBC ? match.orderId : null,
    }));
    if (updated) queueSaveRow(updated);
    setCottonMatches((current) => ({ ...current, [id]: [match] }));
  }

  async function checkIn(row: CheckinRow) {
    if (!site || !row.id.startsWith("local-") || createInFlightRef.current.has(row.id)) return;
    createInFlightRef.current.add(row.id);
    setRowUiState(row.id, { saveState: "saving", message: "" });
    try {
      const res = await fetch("/api/inbound/checkin/rows", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: row.id.slice(6),
          terminal: row.terminal, siteCode: row.site_code, siteName: row.site_name,
          subLocation: row.sub_location, receivedDate: row.received_date,
          mark: row.mark, shipper: row.shipper, bolBC: row.bol_bc,
          baleCount: row.bale_count, warehouseLocation: row.warehouse_location,
          equipmentType: row.equipment_type,
          comment1: row.comment_1, comment2: row.comment_2,
          matchedOrderId: row.matched_order_id,
          truckingCompany: row.trucking_company,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Check-in failed");
      const timer = saveTimersRef.current[row.id];
      if (timer) window.clearTimeout(timer);
      delete saveTimersRef.current[row.id];
      const latest = rowsRef.current.find((item) => item.id === row.id) ?? row;
      const saved = {
        ...data.row, ...latest, id: data.row.id, client_id: row.id,
        created_at: data.row.created_at, updated_at: data.row.updated_at,
        last_saved_at: data.row.last_saved_at,
        draft_status: data.row.draft_status, processed_at: data.row.processed_at,
      } as CheckinRow;
      editRevisionRef.current[data.row.id] = editRevisionRef.current[row.id] ?? 0;
      delete editRevisionRef.current[row.id];
      rowsRef.current = orderCheckinRows(rowsRef.current.map((item) => item.id === row.id ? saved : item));
      setRows((prev) => orderCheckinRows(prev.map((item) => item.id === row.id ? saved : item)));
      setRowUi((prev) => {
        const next = { ...prev };
        delete next[row.id];
        next[data.row.id] = createEmptyUiState();
        return next;
      });
      if (latest !== row || saved.warehouse_location) {
        queueSaveRow(saved);
      }
    } catch (error) {
      setRowUiState(row.id, { saveState: "error", message: error instanceof Error ? error.message : "Check-in failed" });
    } finally {
      createInFlightRef.current.delete(row.id);
    }
  }

  async function deleteRow(id: string) {
    if (id.startsWith("local-")) {
      setRows((prev) => prev.filter((row) => row.id !== id));
      return;
    }
    const ok = window.confirm("Delete this check-in row?");
    if (!ok) return;

    try {
      const res = await fetch(`/api/inbound/checkin/rows/${id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to delete row");
      }

      setRows((prev) => prev.filter((row) => row.id !== id));
      setRowUi((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to delete row");
    }
  }

  async function reloadRow(id: string) {
    if (!site) return;
    const params = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode });
    try {
      const response = await fetch(`/api/inbound/checkin/rows?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not reload row");
      const current = (result.rows as CheckinRow[]).find((row) => row.id === id);
      if (!current) throw new Error("Check-in row no longer exists");
      rowsRef.current = rowsRef.current.map((row) => row.id === id ? current : row);
      setRows((previous) => previous.map((row) => row.id === id ? current : row));
      delete editSnapshotsRef.current[id];
      setEditingProcessedIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      setRowUiState(id, { saveState: "idle", message: "" });
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not reload row");
    }
  }

  async function beginProcessedEdit(row: CheckinRow) {
    if (row.draft_status !== "processed") return;
    setDispatcherLookupIds((previous) => new Set(previous).add(row.id));
    let dispatcher: string | null = null;
    try {
      const response = await fetch(`/api/inbound/checkin/rows/${row.id}/dispatcher`, { cache: "no-store" });
      if (response.ok) {
        const result = await response.json();
        dispatcher = result.dispatcherName || (result.dispatcherId ? `McLeod user ${result.dispatcherId}` : null);
      }
    } catch {
      // The warning must still work when McLeod cannot be reached.
    } finally {
      setDispatcherLookupIds((previous) => {
        const next = new Set(previous);
        next.delete(row.id);
        return next;
      });
    }
    const contact = dispatcher ? `contact ${dispatcher}` : "contact the dispatcher";
    const ok = window.confirm(
      `SCM order #${row.matched_order_id ?? "unknown"} has already been delivered in McLeod. Editing this check-in will not change or undo that delivery. If the mark is wrong, the load was not actually delivered, or there is another delivery issue, ${contact} so McLeod can be corrected. Continue?`
    );
    if (!ok) return;
    editSnapshotsRef.current[row.id] = { ...row };
    setEditingProcessedIds((previous) => new Set(previous).add(row.id));
  }

  function cancelProcessedEdit(id: string) {
    const original = editSnapshotsRef.current[id];
    if (!original) return;
    rowsRef.current = rowsRef.current.map((row) => row.id === id ? original : row);
    setRows((previous) => previous.map((row) => row.id === id ? original : row));
    delete editSnapshotsRef.current[id];
    setEditingProcessedIds((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    setRowUiState(id, { saveState: "idle", message: "" });
  }

  async function saveProcessedEdit(id: string) {
    const original = editSnapshotsRef.current[id];
    const row = rowsRef.current.find((item) => item.id === id);
    if (!original || !row || row.draft_status !== "processed") return;
    setRowUiState(id, { saveState: "saving", message: "" });
    try {
      const response = await fetch(`/api/inbound/checkin/rows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correctionOnly: true,
          expectedUpdatedAt: original.updated_at,
          subLocation: row.sub_location, receivedDate: row.received_date,
          mark: row.mark, shipper: row.shipper, bolBC: row.bol_bc,
          baleCount: row.bale_count, warehouseLocation: row.warehouse_location,
          equipmentType: row.equipment_type,
          comment1: row.comment_1, comment2: row.comment_2,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Correction could not be saved");
      const saved = result.row as CheckinRow;
      rowsRef.current = rowsRef.current.map((item) => item.id === id ? saved : item);
      setRows((previous) => previous.map((item) => item.id === id ? saved : item));
      delete editSnapshotsRef.current[id];
      setEditingProcessedIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      setRowUiState(id, { saveState: "saved", message: "" });
    } catch (error) {
      setRowUiState(id, { saveState: "error", message: error instanceof Error ? error.message : "Correction could not be saved" });
    }
  }

  async function handleCopyTable() {
    if (!rows.length) {
      alert("No rows to copy");
      return;
    }

    const sanitizeCell = (value: unknown) =>
      String(value ?? "")
        .replace(/\r?\n|\r/g, " ")
        .replace(/\t/g, " ")
        .trim();

    const headers = [
      "Received Date",
      "Arrival Time",
      "SCM Order #",
      "Mark",
      "Customer",
      "BOL B/C",
      "Bales",
      "Equipment",
      "Sub-Location",
      "Comment",
      "Warehouse Location",
      "Status",
    ];

    const lines = [
      headers.join("\t"),
      ...rows.map((row) =>
        [
          sanitizeCell(row.received_date),
          sanitizeCell(formatArrivalTime(row)),
          sanitizeCell(row.matched_order_id),
          sanitizeCell(row.mark),
          sanitizeCell(row.shipper),
          sanitizeCell(row.bol_bc),
          sanitizeCell(row.bale_count),
          sanitizeCell(row.equipment_type),
          sanitizeCell(row.sub_location),
          sanitizeCell([row.comment_1, row.comment_2].filter(Boolean).join(" / ")),
          sanitizeCell(row.warehouse_location),
          sanitizeCell(row.draft_status),
        ].join("\t")
      ),
    ];

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      alert(`Copied ${rows.length} row${rows.length === 1 ? "" : "s"} to clipboard`);
    } catch {
      alert("Failed to copy table");
    }
  }

  const readyCount = rows.filter((row) => row.draft_status === "ready").length;
  const processedCount = rows.filter((row) => row.draft_status === "processed").length;
  const outsideCount = rows.filter((row) => row.draft_status === "outside_carrier").length;
  const waitingCount = rows.filter((row) => row.draft_status === "checked_in" && usesMcleodCheckin(row)).length;
  const gateOnlyCount = rows.filter((row) => row.checkin_source === "driver_qr" && !usesMcleodCheckin(row)).length;
  const failedCount = rows.filter((row) => row.draft_status === "failed" || Boolean(cottonShortage(row) && !row.customer_notified_at)).length;

  if (!site || !site.materials.includes("cotton")) {
    return (
      <main style={{ maxWidth: "100%", padding: "0 16px" }}>
        <PlatformPageHeader
          title="Check-In Site Not Found"
          subtitle="That site route does not match the configured check-in locations."
          actions={
            <Link href="/inbound/checkin" style={linkButtonStyle}>
              Back to Check-In Sites
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <main style={{ maxWidth: "100%", padding: "0 16px" }}>
      <PlatformPageHeader
        title={`${site.siteName} Check-In`}
        subtitle={viewCarryover ? "Earlier cotton check-ins needing review" : "Cotton arrivals · enter confirmed bales and location to finish a delivery"}

      />


      <SourceLoadAlerts terminal={site.terminal} siteCode={site.siteCode} />
      <PlatformPanel style={{ padding: 16 }}>
        <div style={gridToolbarStyle}>
          <div>
            <strong style={{ color: "#f8fafc" }}>{viewCarryover ? "Earlier check-ins" : `${warehouseDate(new Date(), site.terminal)} · Cotton`}</strong>
            <div style={summaryStyle}>{waitingCount} waiting · {gateOnlyCount} pickups · {processedCount} processed
              {readyCount > 0 ? ` · ${readyCount} ready` : ""}
              {outsideCount > 0 ? ` · ${outsideCount} outside carrier` : ""}
              {failedCount > 0 ? ` · ${failedCount} need attention` : ""}
            </div>
            {carryover.count > 0 && <div role="status" style={{ ...summaryStyle, color: "#fbbf24" }}>
              {carryover.count} earlier row{carryover.count === 1 ? "" : "s"} need review
              {carryover.missingLocation > 0 ? ` · ${carryover.missingLocation} missing location` : ""}
              {carryover.missingBales > 0 ? ` · ${carryover.missingBales} missing bales` : ""}
            </div>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={toolbarButtonStyle} onClick={() => setViewCarryover((current) => !current)}>
              {viewCarryover ? "Today" : `Earlier (${carryover.count})`}
            </button>
            <button type="button" style={toolbarButtonStyle} onClick={() => void handleCopyTable()}>Copy table</button>
            {!viewCarryover && <button type="button" style={toolbarPrimaryStyle} onClick={() => {
              setNewError(""); setNewMatches([]); setNewCheckin(blankRow());
            }}>+ New check-in</button>}
          </div>
        </div>
        <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
          <table className="domestic-table" style={{ width: "100%", minWidth: 1300, tableLayout: "fixed", borderCollapse: "collapse" }}>
            <colgroup>
              {[5, 9, 11, 13, 13, 12, 10, 9, 11, 7].map((width, index) => (
                <col key={index} style={{ width: `${width}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th style={rowNumberHeaderStyle}>#</th>
                <th style={thStyle}>Arrival</th>
                <th style={thStyle}>Mark *</th>
                <th style={thStyle}>Customer *</th>
                <th style={thStyle}>Trucking company</th>
                <th style={thStyle}><span style={baleHeaderStyle}><span>BOL bales</span><span>Unloaded</span></span></th>
                <th style={thStyle}>Equipment *</th>
                <th style={thStyle}>Comment</th>
                <th style={thStyle}>Location * (final)</th>
                <th style={thStyle}>Status / action</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => {
                const ui = rowUi[row.id] ?? createEmptyUiState();

                return (
                  <Fragment key={row.client_id ?? row.id}>
                  <tr data-checkin-id={row.id}
                    style={{ background: index % 2 ? "rgba(30,41,59,0.18)" : undefined, ...rowTone(row) }}>
                    <td style={rowNumberCellStyle}>{index + 1}
                      {row.matched_order_id && <div style={{ marginTop: 3 }}><ScmOrderBadge orderId={row.matched_order_id} /></div>}
                      {row.has_bol_photo && <div style={{ marginTop: 4 }}><PaperworkPhotoLink checkinId={row.id} compact /></div>}
                    </td>

                    <td style={tdStyle}>
                      <input
                        type="date"
                        title={row.checked_in_at ? `Arrived ${formatArrivalTime(row)}` : "Received date"}
                        value={row.received_date ?? ""}
                        onChange={(e) => {
                          const value = e.target.value || null;
                          const updated = applyRowUpdate(row.id, (current) => ({
                            ...current,
                            received_date: value,
                          }));
                          if (updated) queueSaveRow(updated);
                        }}
                        onKeyDown={(e) => handleGridKeyDown(e, index, "received_date")}
                        ref={(el) => registerCellRef(index, "received_date", el)}
                        style={{ ...cellInputStyle, fontSize: 11, padding: "3px 4px" }}
                        disabled={isReadOnlyRow(row)}
                      />
                    </td>

                    <td style={tdStyle}>
                      <input
                        type="text"
                        data-checkin-identity={row.id}
                        value={row.mark ?? ""}
                        onChange={(e) => {
                          const value = e.target.value.toUpperCase();
                          const updated = applyRowUpdate(row.id, (current) => ({
                            ...current,
                            mark: value,
                            matched_order_id: value === current.mark ? current.matched_order_id : null,
                          }));
                          if (updated) queueSaveRow(updated);
                        }}
                        onKeyDown={(e) => handleGridKeyDown(e, index, "mark")}
                        onBlur={() => {
                          const latest = rowsRef.current.find((item) => item.id === row.id);
                          if (latest) queueSaveRow(latest);
                        }}
                        ref={(el) => registerCellRef(index, "mark", el)}
                        style={cellInputStyle}
                        disabled={isReadOnlyRow(row)}
                      />

                    </td>

                    <td style={tdStyle}>
                      <input
                        list="customer-list"
                        data-checkin-identity={row.id}
                        value={row.shipper ?? ""}
                        onChange={(e) => {
                          const value = e.target.value.toUpperCase();
                          const updated = applyRowUpdate(row.id, (current) => ({
                            ...current,
                            shipper: value,
                          }));
                          if (updated) queueSaveRow(updated);
                        }}
                        onKeyDown={(e) => handleGridKeyDown(e, index, "shipper")}
                        onBlur={() => {
                          const latest = rowsRef.current.find((item) => item.id === row.id);
                          if (latest) queueSaveRow(latest);
                        }}
                        ref={(el) => registerCellRef(index, "shipper", el)}
                        style={cellInputStyle}
                        disabled={isReadOnlyRow(row)}
                        placeholder="Start typing customer..."
                      />
                    </td>
                    <td style={tdStyle}><input aria-label={`Trucking company for row ${index + 1}`}
                      value={row.trucking_company ?? ""} placeholder="Company not entered"
                      onChange={(event) => {
                        const updated = applyRowUpdate(row.id, (current) => ({ ...current, trucking_company: event.target.value }));
                        if (updated) queueSaveRow(updated);
                      }}
                      onBlur={() => {
                        const latest = rowsRef.current.find((item) => item.id === row.id);
                        if (latest) queueSaveRow(latest);
                      }}
                      style={cellInputStyle} disabled={isReadOnlyRow(row)} /></td>

                    <td style={tdStyle}>
                      <div style={baleFieldsStyle}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        type="text"
                        data-checkin-identity={row.id}
                        data-checkin-bol={row.id}
                        aria-label={`BOL bales for row ${index + 1}`}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={row.bol_bc?.toString() ?? ""}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "");
                          const updated = applyRowUpdate(row.id, (current) => ({
                            ...current,
                            bol_bc: digits ? Number(digits) : null,
                            matched_order_id: cottonMatches[row.id]?.[0]?.bolBC && digits &&
                              Number(digits) !== cottonMatches[row.id][0].bolBC ? null : current.matched_order_id,
                          }));
                          if (updated) queueSaveRow(updated);
                        }}
                        onKeyDown={(e) => handleGridKeyDown(e, index, "bol_bc")}
                        onBlur={() => {
                          const latest = rowsRef.current.find((item) => item.id === row.id);
                          if (latest) queueSaveRow(latest);
                        }}
                        ref={(el) => registerCellRef(index, "bol_bc", el)}
                        style={cellInputStyle}
                        disabled={isReadOnlyRow(row)}
                      />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label={`Unloaded bales for row ${index + 1}`}
                        value={row.bale_count?.toString() ?? ""}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "");
                          const updated = applyRowUpdate(row.id, (current) => ({
                            ...current,
                            bale_count: digits ? Number(digits) : null,
                          }));
                          if (updated) queueSaveRow(updated);
                        }}
                        onKeyDown={(e) => handleGridKeyDown(e, index, "bale_count")}
                        ref={(el) => registerCellRef(index, "bale_count", el)}
                        style={cellInputStyle}
                        disabled={isReadOnlyRow(row)}
                      />
                        </div>
                      </div>
                    </td>

                    <td style={tdStyle}>
                      <select
                        value={row.equipment_type ?? (row.terminal === "SAV" ? "V" : "")}
                        onChange={(e) => {
                          const value = e.target.value || null;
                          const updated = applyRowUpdate(row.id, (current) => ({
                            ...current,
                            equipment_type: value as "V" | "F" | null,
                          }));
                          if (updated) queueSaveRow(updated);
                        }}
                        onKeyDown={(e) => handleGridKeyDown(e, index, "equipment_type")}
                        ref={(el) => registerCellRef(index, "equipment_type", el)}
                        style={cellInputStyle}
                        disabled={isReadOnlyRow(row)}
                      >
                        <option value="">Select</option>
                        <option value="V">V</option>
                        <option value="F">F</option>
                      </select>
                    </td>

                    <td style={tdStyle}>
                      <textarea
                        value={[row.comment_1, row.comment_2].filter(Boolean).join("\n")}
                        onChange={(e) => {
                          const updated = applyRowUpdate(row.id, (current) => ({
                            ...current,
                            comment_1: e.target.value,
                            comment_2: null,
                          }));
                          if (updated) queueSaveRow(updated);
                        }}
                        onKeyDown={(e) => handleGridKeyDown(e, index, "comment_1")}
                        ref={(el) => registerCellRef(index, "comment_1", el)}
                        style={cellTextareaStyle}
                        placeholder="Damage, shortage, and customer follow-up notes"
                        disabled={row.draft_status !== "delivery_blocked" && isReadOnlyRow(row)}
                      />
                    </td>

                    <td style={tdStyle}>
                      <input
                        type="text"
                        data-checkin-location={row.id}
                        value={row.warehouse_location ?? ""}
                        onChange={(e) => {
                          const value = e.target.value.toUpperCase();
                          const updated = applyRowUpdate(row.id, (current) => ({
                            ...current,
                            warehouse_location: value,
                          }));
                          if (updated) queueSaveRow(updated);
                        }}
                        onKeyDown={(e) => handleGridKeyDown(e, index, "warehouse_location")}
                        onBlur={() => {
                          const latest = rowsRef.current.find((item) => item.id === row.id);
                          if (latest) queueSaveRow(latest);
                        }}
                        ref={(el) => registerCellRef(index, "warehouse_location", el)}
                        style={cellInputStyle}
                        disabled={isReadOnlyRow(row)}
                      />
                    </td>

                    <td style={tdStyle}>
                      <div style={rowActionStatusStyle}>
                        <div style={rowStatusStyle}>
                      <div title={row.draft_status} style={rowDotStyle(row)} />
                      <small>{row.id.startsWith("local-") ? "" : row.draft_status === "checked_in"
                        ? usesMcleodCheckin(row) ? "Waiting" : "Gate only"
                        : row.draft_status === "delivery_blocked" ? "Receiving complete" : row.draft_status}</small>
                      {row.processing_error || ui.saveState === "error" ? (
                        <button type="button" title={row.processing_error || ui.message || "Save failed"}
                          aria-label="Show check-in error"
                          onClick={() => setExpandedIds((current) => new Set(current).add(row.id))}
                          style={errorButtonStyle}>View error</button>
                      ) : null}
                        </div>
                        {(row.processing_error || ui.saveState === "error") && <small
                          title={row.processing_error || ui.message || "Save failed"}
                          style={{ color: "#fca5a5", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%", display: "block" }}>
                          {row.processing_error || ui.message || "Save failed"}
                        </small>}
                        {cottonShortage(row) && <button type="button" style={{ ...smallActionButtonStyle, color: "#fde68a", borderColor: "#d97706" }} onClick={() => setExpandedIds((current) => new Set(current).add(row.id))}>
                          {cottonShortage(row)!.missing} bales short · {row.customer_notified_at ? "Customer notified" : "Notify customer"}
                        </button>}
                        <div style={rowActionsStyle}>
                      {(!row.id.startsWith("local-") || row.mark) && <button type="button"
                        onClick={() => toggleDetails(row.id)} style={smallActionButtonStyle}
                        aria-expanded={expandedIds.has(row.id)}>
                        {expandedIds.has(row.id) ? "Less" : !row.matched_order_id && (cottonMatches[row.id]?.length ?? 0) > 0 ? "Review order" : "Details"}
                      </button>}
                      {row.draft_status === "processed" && !editingProcessedIds.has(row.id) ? (
                        <button type="button" onClick={() => void beginProcessedEdit(row)} disabled={dispatcherLookupIds.has(row.id)}
                          style={smallActionButtonStyle} title="Edit check-in details; McLeod delivery stays unchanged">
                          {dispatcherLookupIds.has(row.id) ? "Loading..." : "Edit"}
                        </button>
                      ) : null}
                      {row.draft_status === "processed" && editingProcessedIds.has(row.id) ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <button type="button" onClick={() => void saveProcessedEdit(row.id)}
                            disabled={ui.saveState === "saving"} style={smallActionButtonStyle}>Save</button>
                          <button type="button" onClick={() => cancelProcessedEdit(row.id)}
                            disabled={ui.saveState === "saving"} style={smallActionButtonStyle}>Cancel</button>
                        </div>
                      ) : null}
                      {row.id.startsWith("local-") ? (
                        (rowUi[row.id]?.saveState === "error" ?
                          <button type="button" onClick={() => void checkIn(row)}
                            style={smallActionButtonStyle}>Retry save</button> : null)
                      ) : null}
                      {row.draft_status === "failed" && !cottonShortage(row) ? (
                        <button type="button" onClick={() => void saveRowSnapshot(row)}
                          style={smallActionButtonStyle}>Retry</button>
                      ) : null}
                      {!row.id.startsWith("local-") && ui.saveState === "error" ? (
                        <button type="button" onClick={() => void reloadRow(row.id)}
                          title="Discard unsaved edits and load the latest row" style={smallActionButtonStyle}>Reload</button>
                      ) : null}
                      {!isClosedRow(row) && row.draft_status !== "delivery_blocked" ? <button
                        type="button"
                        onClick={() => void deleteRow(row.id)}
                        style={deleteButtonStyle}
                        aria-label={`Delete check-in row ${index + 1}`}
                        title="Delete check-in"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v7m4-7v7" />
                        </svg>
                      </button> : null}
                        </div>
                      </div>
                    </td>
                  </tr>
                  {expandedIds.has(row.id) && <tr style={{ background: "#132337" }}>
                    <td colSpan={10} style={detailsCellStyle}>
                      <ShortageNotice row={row} complete={isCompleteCheckin(row)} disabled={ui.saveState === "saving" || isClosedRow(row)} onAction={isClosedRow(row) ? undefined : async (action) => {
                        const timer = saveTimersRef.current[row.id];
                        if (timer) { window.clearTimeout(timer); delete saveTimersRef.current[row.id]; }
                        const latest = rowsRef.current.find((item) => item.id === row.id);
                        if (latest) await saveRowSnapshot(latest, action);
                      }} />
                      <div style={detailsContentStyle}>
                        {row.checked_in_at && <span>Arrived {formatArrivalTime(row)} · {row.received_date}</span>}
                        {row.driver_name && <span>Driver: {row.driver_name}{row.driver_phone ? ` · ${row.driver_phone}` : ""}</span>}
                        {row.trucking_company && <span>Trucking company: {row.trucking_company}</span>}
                        {row.identity_corrected_at && <span>Identity corrected</span>}
                        {row.checkin_source === "driver_qr" && <a href={`/warehouse/checkin/${row.id}`} target="_blank" rel="noreferrer" style={detailLinkStyle}>
                          QR driver details · {row.movement_direction ?? "delivery"}
                        </a>}
                        {row.reference_number && <span>Reference: {row.reference_number}</span>}
                        {row.movement_direction === "pickup" && row.destination && <span>To: {row.destination}</span>}
                        {row.has_bol_photo && <a href={`/api/warehouse/checkin-bol/${row.id}`} target="_blank" rel="noreferrer" style={detailLinkStyle}>View paperwork</a>}
                      {row.matched_order_id ? (
                        <small style={orderNumberStyle} title={row.draft_status === "failed" ? "Possible McLeod match; review before delivery" : "Matched SCM order"}>
                          {row.draft_status === "failed" ? "Possible #" : "SCM #"}{row.matched_order_id}
                        </small>
                      ) : null}
                      {!row.matched_order_id && cottonSearching[row.id] ? <small style={orderNumberStyle}>Searching McLeod…</small> : null}
                      {!row.matched_order_id && cottonWarnings[row.id] ? <small style={{ ...gateReferenceStyle, color: "#fbbf24", fontSize: 11 }} title={cottonWarnings[row.id]}>Search incomplete · check manually</small> : null}
                      {!row.matched_order_id && !cottonSearching[row.id] && !cottonWarnings[row.id] && cottonMatches[row.id]?.length === 1 && !cottonMatches[row.id][0].completion ?
                        <small style={orderNumberStyle} title="Possible order; mark needs an exact match before it is linked">Possible #{cottonMatches[row.id][0].orderId}</small> : null}
                      {!row.matched_order_id && !cottonSearching[row.id] && !cottonWarnings[row.id] && cottonMatches[row.id]?.length === 0 ?
                        <small style={gateReferenceStyle}>No order found</small> : null}
                      {!row.matched_order_id && cottonMatches[row.id]?.length > 0 ?
                        <div style={{ maxHeight: 140, overflowY: "auto" }}>
                          {cottonMatches[row.id].map((match) => match.completion ?
                            <CompletedOrderNotice key={match.orderId} orderId={match.orderId} completion={match.completion} /> : <button key={match.orderId} type="button"
                            disabled={isReadOnlyRow(row)} onClick={() => chooseCottonMatch(row.id, match)}
                            style={{ ...smallActionButtonStyle, textAlign: "left", marginTop: 4, display: "block" }}>
                            <strong>#{match.orderId} · {match.customer || "Unknown customer"} · {match.bolBC ?? "?"} B/C</strong>
                            <span className="row-secondary">{match.carrierName || (match.carrierCode ? `Carrier code: ${match.carrierCode}` : "Carrier not assigned")}
                              {" · "}{formatOrderDate(match.orderDate)} · {match.orderStatus || "Status unavailable"}</span>
                          </button>)}
                        </div> : null}
                        {(row.processing_error || ui.message) && <span style={{ color: "#fca5a5" }}>{row.processing_error || ui.message}</span>}
                      </div>
                    </td>
                  </tr>}
                  </Fragment>
                );
              })}

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} style={emptyStateStyle}>
                    {loading
                      ? "Loading rows..."
                      : viewCarryover ? "No earlier cotton check-ins need review." : "No cotton check-ins yet. Use New check-in to add a truck."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <datalist id="customer-list">
            {CHECKIN_CUSTOMERS.map((customer) => (
              <option key={customer} value={customer} />
            ))}
          </datalist>
        </div>
      </PlatformPanel>
      {newCheckin && <div style={modalBackdropStyle} onMouseDown={(event) => {
        if (event.target === event.currentTarget && !newSaving) setNewCheckin(null);
      }}>
        <form role="dialog" aria-modal="true" aria-labelledby="new-cotton-title" style={modalCardStyle}
          onKeyDown={(event) => { if (event.key === "Escape" && !newSaving) { event.preventDefault(); setNewCheckin(null); } }}
          onSubmit={(event) => { event.preventDefault(); void saveNewCheckin(); }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
            <div><h2 id="new-cotton-title" style={{ margin: 0, fontSize: 22 }}>New cotton check-in</h2>
              <p style={{ margin: "5px 0 0", color: "#94a3b8", fontSize: 13 }}>Enter the mark to find the SCM order. Confirm the BOL bale count.</p></div>
            <button type="button" style={toolbarButtonStyle} disabled={newSaving} onClick={() => setNewCheckin(null)}>Close</button>
          </div>
          {newError && <p role="alert" style={{ color: "#fca5a5" }}>{newError}</p>}
          <div style={modalGridStyle}>
            <label style={{ ...modalLabelStyle, gridColumn: "1 / -1" }}>Mark *
              <input autoFocus required style={modalInputStyle} value={newCheckin.mark ?? ""} onChange={(event) => {
                setNewError(""); setNewMatches([]);
                setNewCheckin((current) => current && { ...current, mark: event.target.value.toUpperCase(), matched_order_id: null });
              }} placeholder="Mark on the BOL" /></label>
            <div style={{ gridColumn: "1 / -1", color: "#93c5fd", fontSize: 13 }} aria-live="polite">
              {newSearching ? "Searching McLeod…" : newCheckin.matched_order_id ? `SCM order #${newCheckin.matched_order_id} found` :
                newMatches.length === 0 && (newCheckin.mark?.length ?? 0) >= 3 && !newError ? "No recent SCM order found. Enter the details below." : null}
              {!newCheckin.matched_order_id && newMatches.length > 0 && <div style={{ display: "grid", gap: 7, marginTop: 8 }}>
                {newMatches.map((match) => match.completion ?
                  <CompletedOrderNotice key={match.orderId} orderId={match.orderId} completion={match.completion} /> : <button type="button" key={match.orderId} style={{ ...toolbarButtonStyle, textAlign: "left" }}
                  onClick={() => { setNewCheckin((current) => current && { ...current, mark: match.mark,
                    shipper: match.customer, bol_bc: match.bolBC || current.bol_bc, matched_order_id: match.orderId,
                    driver_name: current.driver_name || match.driverName, driver_phone: current.driver_phone || match.driverPhone,
                    trucking_company: match.carrierName || current.trucking_company });
                    setNewError(""); }}>
                  <strong>#{match.orderId} · {match.customer || "Unknown customer"} · {match.bolBC ?? "?"} B/C</strong>
                  <span className="row-secondary">{match.carrierName || (match.carrierCode ? `Carrier code: ${match.carrierCode}` : "Carrier not assigned")}
                    {" · "}{formatOrderDate(match.orderDate)} · {match.orderStatus || "Status unavailable"}</span>
                </button>)}
              </div>}
            </div>
            <label style={modalLabelStyle}>Customer *
              <input required list="customer-list" style={modalInputStyle} value={newCheckin.shipper ?? ""} onChange={(event) =>
                setNewCheckin((current) => current && { ...current, shipper: event.target.value.toUpperCase(), matched_order_id: null })} placeholder="Customer" /></label>
            <label style={modalLabelStyle}>BOL bale count *
              <input required inputMode="numeric" pattern="[0-9]*" style={modalInputStyle} value={newCheckin.bol_bc ?? ""} onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "");
                setNewCheckin((current) => current && { ...current, bol_bc: digits ? Number(digits) : null,
                  matched_order_id: current.matched_order_id && newMatches.find((match) => match.orderId === current.matched_order_id)?.bolBC &&
                    Number(digits) !== newMatches.find((match) => match.orderId === current.matched_order_id)?.bolBC
                    ? null : current.matched_order_id });
              }} placeholder="Bales on BOL" /></label>
            <label style={modalLabelStyle}>Driver name
              <input style={modalInputStyle} value={newCheckin.driver_name ?? ""} onChange={(event) =>
                setNewCheckin((current) => current && { ...current, driver_name: event.target.value })} placeholder="Confirm driver name" /></label>
            <label style={modalLabelStyle}>Driver phone
              <input type="tel" style={modalInputStyle} value={newCheckin.driver_phone ?? ""} onChange={(event) =>
                setNewCheckin((current) => current && { ...current, driver_phone: event.target.value })} placeholder="Confirm phone number" /></label>
            <label style={{ ...modalLabelStyle, gridColumn: "1 / -1" }}>Trucking company
              <input style={modalInputStyle} value={newCheckin.trucking_company ?? ""} onChange={(event) =>
                setNewCheckin((current) => current && { ...current, trucking_company: event.target.value })} placeholder="Carrier name" /></label>
            <label style={modalLabelStyle}>Equipment
              <select style={modalInputStyle} value={newCheckin.equipment_type ?? ""} onChange={(event) =>
                setNewCheckin((current) => current && { ...current, equipment_type: event.target.value as "V" | "F" || null })}>
                <option value="">Select</option><option value="V">Van</option><option value="F">Flatbed</option>
              </select></label>
            <label style={{ ...modalLabelStyle, gridColumn: "1 / -1" }}>Comment
              <input style={modalInputStyle} value={newCheckin.comment_1 ?? ""} onChange={(event) =>
                setNewCheckin((current) => current && { ...current, comment_1: event.target.value })} placeholder="Optional note" /></label>
          </div>
          <p style={{ color: "#94a3b8", fontSize: 12, margin: "18px 0" }}>Unloaded bales and final warehouse location can be confirmed on the grid after arrival.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" style={toolbarButtonStyle} disabled={newSaving} onClick={() => setNewCheckin(null)}>Cancel</button>
            <button type="submit" style={toolbarPrimaryStyle} disabled={newSaving || newSearching || (newMatches.length > 0 && newMatches.every((match) => match.completion))}>{newSaving ? "Checking in…" : "Check in truck"}</button>
          </div>
        </form>
      </div>}
    </main>
  );
}

const rowNumberHeaderStyle: React.CSSProperties = {
  width: 34,
  minWidth: 34,
  textAlign: "center",
  padding: "6px 3px",
  color: "#94a3b8",
  fontSize: 12,
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(148,163,184,0.16)",
  background: "rgba(15,23,42,0.96)",
  position: "sticky",
  top: 0,
  zIndex: 3,
};

const rowNumberCellStyle: React.CSSProperties = {
  width: 34,
  minWidth: 34,
  textAlign: "center",
  padding: "4px 2px",
  borderBottom: "1px solid rgba(148,163,184,0.08)",
  verticalAlign: "middle",
  color: "#94a3b8",
  fontWeight: 700,
  fontSize: 12,
};

const utilityLinkStyle: React.CSSProperties = {
  color: "#94a3b8", fontSize: 13, textDecoration: "none", fontWeight: 700,
};
const gridToolbarStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  flexWrap: "wrap", gap: 12, marginBottom: 14,
};
const summaryStyle: React.CSSProperties = { color: "#94a3b8", fontSize: 12, marginTop: 4 };
const toolbarButtonStyle: React.CSSProperties = {
  padding: "8px 11px", borderRadius: 7, border: "1px solid #475569",
  background: "#0f172a", color: "#e2e8f0", cursor: "pointer", fontSize: 12, fontWeight: 700,
};
const toolbarPrimaryStyle: React.CSSProperties = {
  ...toolbarButtonStyle, background: "#4338ca", borderColor: "#6366f1", color: "#fff",
};
const baleFieldsStyle: React.CSSProperties = { display: "flex", gap: 8 };
const modalBackdropStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 100, background: "rgba(2,6,23,.78)", display: "grid", placeItems: "center", padding: 16 };
const modalCardStyle: React.CSSProperties = { width: "min(100%, 620px)", maxHeight: "90vh", overflowY: "auto", padding: 24, borderRadius: 14, border: "1px solid #475569", background: "#111c30", boxShadow: "0 24px 70px rgba(0,0,0,.55)", color: "#f8fafc" };
const modalGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 };
const modalLabelStyle: React.CSSProperties = { display: "grid", gap: 6, minWidth: 0, color: "#cbd5e1", fontSize: 13, fontWeight: 700 };
const modalInputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", height: 40, border: "1px solid #475569", borderRadius: 6, background: "#0b1425", color: "#f8fafc", padding: "8px 10px", fontSize: 13 };
function formatOrderDate(value: string) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value || "Date unavailable";
}
const baleHeaderStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 };
const rowActionStatusStyle: React.CSSProperties = { display: "grid", gap: 5 };
const rowStatusStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", fontSize: 11,
};
const rowActionsStyle: React.CSSProperties = { display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" };
const detailsCellStyle: React.CSSProperties = { padding: "12px 16px", borderBottom: "1px solid #334155", color: "#cbd5e1", fontSize: 12 };
const detailsContentStyle: React.CSSProperties = { display: "flex", gap: "8px 18px", alignItems: "center", flexWrap: "wrap" };
const detailLinkStyle: React.CSSProperties = { color: "#67e8f9", textDecoration: "underline" };

const errorButtonStyle: React.CSSProperties = {
  display: "inline",
  marginLeft: 4,
  padding: 0,
  border: 0,
  background: "transparent",
  color: "#fca5a5",
  fontSize: 10,
  cursor: "pointer",
  textDecoration: "underline",
};

const gateReferenceStyle: React.CSSProperties = {
  display: "block",
  marginTop: 2,
  color: "#94a3b8",
  fontSize: 8,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const orderNumberStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  color: "#93c5fd",
  whiteSpace: "nowrap",
  marginTop: 2,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 6px",
  color: "#94a3b8",
  fontSize: 12,
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(148,163,184,0.16)",
  background: "rgba(15,23,42,0.96)",
  position: "sticky",
  top: 0,
  zIndex: 2,
};

const tdStyle: React.CSSProperties = {
  padding: "10px 6px",
  borderBottom: "1px solid rgba(148,163,184,0.08)",
  verticalAlign: "middle",
  color: "#e5e7eb",
};

const cellInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 34,
  boxSizing: "border-box",
  padding: "4px 6px",
  borderRadius: 6,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.82)",
  color: "#e2e8f0",
  fontSize: 12,
};

const cellTextareaStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  minHeight: 30,
  height: 30,
  boxSizing: "border-box",
  padding: "4px 6px",
  borderRadius: 6,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.82)",
  color: "#e2e8f0",
  fontSize: 12,
  resize: "vertical",
};

const emptyStateStyle: React.CSSProperties = {
  padding: "30px 16px",
  textAlign: "center",
  color: "#94a3b8",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid rgba(99,102,241,0.42)",
  background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 800,
  textDecoration: "none",
  minHeight: 46,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 8px 22px rgba(79,70,229,0.28)",
};

const linkButtonStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.22)",
  background: "rgba(15,23,42,0.84)",
  color: "#e2e8f0",
  cursor: "pointer",
  fontWeight: 800,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 46,
};

const deleteButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  padding: 5,
  borderRadius: 6,
  border: "1px solid rgba(239,68,68,0.25)",
  background: "rgba(127,29,29,0.26)",
  color: "#fecaca",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const smallActionButtonStyle: React.CSSProperties = {
  minHeight: 25,
  minWidth: 58,
  padding: "3px 5px",
  borderRadius: 6,
  border: "1px solid rgba(148,163,184,0.35)",
  background: "rgba(30,41,59,0.9)",
  color: "#e2e8f0",
  fontSize: 11,
  cursor: "pointer",
};
