"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import PlatformPageHeader from "@/components/platform/PlatformPageHeader";
import PlatformPanel from "@/components/platform/PlatformPanel";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";
import { warehouseDate } from "@/lib/inbound/checkin/geofence";
import { isReadyCheckin, usesMcleodCheckin } from "@/lib/inbound/checkin/ready";
import { CUSTOMER_XREF } from "@/lib/mcleod/inbound/xref";

type CheckinRow = {
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
  draft_status: "draft" | "checked_in" | "ready" | "processing" | "processed" | "outside_carrier" | "failed";
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

type CottonMatch = { orderId: string; mark: string; customer: string; bolBC: number | null };

type ColumnKey =
  | "received_date"
  | "mark"
  | "shipper"
  | "bol_bc"
  | "bale_count"
  | "equipment_type"
  | "sub_location"
  | "comment_1"
  | "warehouse_location";

const COLUMN_ORDER: ColumnKey[] = [
  "received_date",
  "mark",
  "shipper",
  "bol_bc",
  "bale_count",
  "equipment_type",
  "sub_location",
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
    margin: "0 auto",
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
  const [viewCarryover, setViewCarryover] = useState(false);
  const [carryover, setCarryover] = useState({ count: 0, missingLocation: 0, missingBales: 0 });
  const dayRef = useRef("");
  const [rowUi, setRowUi] = useState<Record<string, RowUiState>>({});
  const [loading, setLoading] = useState(true);
  const [editingProcessedIds, setEditingProcessedIds] = useState<Set<string>>(new Set());
  const [dispatcherLookupIds, setDispatcherLookupIds] = useState<Set<string>>(new Set());
  const [cottonMatches, setCottonMatches] = useState<Record<string, CottonMatch[]>>({});
  const [cottonSearching, setCottonSearching] = useState<Record<string, boolean>>({});
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
      const key = (row.mark ?? "").trim().toUpperCase();
      if (lookupKeysRef.current[row.id] === key) continue;
      if (lookupTimersRef.current[row.id]) window.clearTimeout(lookupTimersRef.current[row.id]);
      lookupKeysRef.current[row.id] = key;
      setCottonMatches((current) => { const next = { ...current }; delete next[row.id]; return next; });
      if (!site || key.length < 3) {
        setCottonSearching((current) => ({ ...current, [row.id]: false }));
        continue;
      }
      setCottonSearching((current) => ({ ...current, [row.id]: true }));
      lookupTimersRef.current[row.id] = window.setTimeout(async () => {
        delete lookupTimersRef.current[row.id];
        try {
          const query = new URLSearchParams({ terminal: site.terminal, siteCode: site.siteCode, mark: key });
          const response = await fetch(`/api/inbound/checkin/cotton-match?${query}`, { cache: "no-store" });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || "McLeod lookup failed");
          if (lookupKeysRef.current[row.id] !== key) return;
          const found = result.matches as CottonMatch[];
          setCottonMatches((current) => ({ ...current, [row.id]: found }));
          if (found.length === 1 && found[0].customer) {
            const match = found[0];
            const latest = rowsRef.current.find((item) => item.id === row.id);
            if (latest && (latest.mark ?? "").trim().toUpperCase() === key) {
              // Keep the typed mark: an embedded reference may not be the whole consignee reference.
              // Never populate unloaded bales or the final location from the order.
              const updated = applyRowUpdate(row.id, (current) => ({ ...current,
                shipper: current.shipper || match.customer,
                bol_bc: current.bol_bc || match.bolBC,
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
    return isClosedRow(row) &&
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
        return orderCheckinRows([...nextRows.map((row) => active.get(row.id) ?? row), ...pending,
          ...(changedDay && !viewCarryover ? Array.from({ length: 10 }, () => blankRow()) : [])]);
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
    editSnapshotsRef.current = {};
    setEditingProcessedIds(new Set());
    setRows(site && !viewCarryover ? Array.from({ length: 10 }, () => blankRow()) : []);
    setRowUi({});
    void loadRows(true);
    const interval = window.setInterval(() => {
      void loadRows();
    }, 10000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site?.terminal, site?.siteCode, viewCarryover]);

  function setRowUiState(id: string, state: Partial<RowUiState>) {
    setRowUi((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? createEmptyUiState()),
        ...state,
      },
    }));
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

  async function saveRowSnapshot(row: CheckinRow) {
    if (!row || row.id.startsWith("local-") || isClosedRow(row)) return;
    if (willProcess(row) &&
        (document.activeElement?.getAttribute("data-checkin-identity") === row.id ||
         document.activeElement?.getAttribute("data-checkin-location") === row.id)) return;
    if (saveInFlightRef.current.has(row.id)) {
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
            verified_at: savedRow.verified_at, processing_error: savedRow.processing_error }
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
    const updated = applyRowUpdate(id, (row) => ({ ...row,
      shipper: row.shipper || match.customer,
      bol_bc: row.bol_bc || match.bolBC,
    }));
    if (updated) queueSaveRow(updated);
    setCottonMatches((current) => ({ ...current, [id]: [match] }));
  }

  function addRows(count: number) {
    if (!site) return;
    const newRows: CheckinRow[] = Array.from({ length: count }, () => blankRow());
    setRows((prev) => [...prev, ...newRows]);
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
      const newBlank = blankRow();
      editRevisionRef.current[data.row.id] = editRevisionRef.current[row.id] ?? 0;
      delete editRevisionRef.current[row.id];
      rowsRef.current = orderCheckinRows([...rowsRef.current.map((item) => item.id === row.id ? saved : item), newBlank]);
      setRows((prev) => orderCheckinRows([...prev.map((item) => item.id === row.id ? saved : item), newBlank]));
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
  const failedCount = rows.filter((row) => row.draft_status === "failed").length;

  if (!site) {
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
        subtitle={viewCarryover ? "Earlier cotton check-ins that still need attention." : "Today's cotton check-ins. When all required details and the warehouse location are entered, the delivery processes automatically."}
        actions={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/inbound/checkin" style={linkButtonStyle}>
              ← All Check-In Sites
            </Link>

            <Link href="/inbound/history" style={linkButtonStyle}>
              View History
            </Link>

            <Link href={`/warehouse/inventory/${site.terminalSlug}/${site.siteCode}`} style={linkButtonStyle}>
              View Inventory
            </Link>

            <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/containers`} style={linkButtonStyle}>
              Container Line
            </Link>

            <button
              type="button"
              onClick={() => void handleCopyTable()}
              style={linkButtonStyle}
            >
              Copy Table
            </button>

            {!viewCarryover && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => addRows(5)}
                style={primaryButtonStyle}
              >
                + 5 Blank Lines
              </button>
            </div>}
          </div>
        }
      />

      <nav aria-label="Freight type" style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/line`} style={linkButtonStyle}>Domestic Line</Link>
        <span aria-current="page" style={primaryButtonStyle}>Cotton</span>
        <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/domestic`} style={linkButtonStyle}>Lumber & Other</Link>
        <Link href={`/warehouse/gate/${site.terminalSlug}/${site.siteCode}/history`} style={linkButtonStyle}>Domestic History</Link>
      </nav>

      <PlatformPanel style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <strong>{viewCarryover ? "Earlier rows needing review" : `${warehouseDate(new Date(), site.terminal)} · Today's cotton grid`}</strong>
          <button type="button" style={carryover.count ? primaryButtonStyle : linkButtonStyle}
            onClick={() => setViewCarryover((current) => !current)}>
            {viewCarryover ? "Back to today's grid" : `Review earlier rows (${carryover.count})`}
          </button>
        </div>
        {carryover.count > 0 && <p role="status" style={{ color: "#fbbf24", margin: "10px 0 0" }}>
          {carryover.count} earlier cotton check-in{carryover.count === 1 ? "" : "s"} still need review.
          {carryover.missingLocation > 0 ? ` ${carryover.missingLocation} missing a warehouse location.` : ""}
          {carryover.missingBales > 0 ? ` ${carryover.missingBales} missing a confirmed bale count.` : ""}
        </p>}
      </PlatformPanel>

      <PlatformPanel>
        <div style={statsGridStyle}>
          <StatCard label="Waiting for location/details" value={waitingCount} />
          <StatCard label="Cotton pickups" value={gateOnlyCount} />
          <StatCard label="Ready" value={readyCount} tone="success" />
          <StatCard label="Processed" value={processedCount} tone="info" />
          <StatCard label="Outside carrier" value={outsideCount} />
          <StatCard label="Needs attention" value={failedCount} />
          <StatCard label="Sub-Locations" value={site.subLocations.join(", ")} />
        </div>
      </PlatformPanel>

      <PlatformPanel style={{ padding: 16 }}>
        <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
          <table style={{ width: "100%", minWidth: 1180, tableLayout: "fixed", borderCollapse: "collapse" }}>
            <colgroup>
              {[2.5, 9, 8, 8.5, 11.5, 6, 6, 7, 8, 10, 10, 7, 6.5].map((width, index) => (
                <col key={index} style={{ width: `${width}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th style={rowNumberHeaderStyle}>#</th>
                <th style={thStyle}>Date *</th>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Mark *</th>
                <th style={thStyle}>Customer *</th>
                <th style={thStyle}>BOL B/C *</th>
                <th style={thStyle}>Bales *</th>
                <th style={thStyle}>Equipment *</th>
                <th style={thStyle}>Sub-Loc *</th>
                <th style={thStyle}>Comment</th>
                <th style={thStyle}>Location * (final)</th>
                <th style={thStyle}>Actions</th>
                <th style={statusDotHeaderStyle}>Status</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => {
                const ui = rowUi[row.id] ?? createEmptyUiState();

                return (
                  <tr key={row.client_id ?? row.id} data-checkin-id={row.id} style={rowTone(row)}>
                    <td style={rowNumberCellStyle}>{index + 1}</td>

                    <td style={tdStyle}>
                      <input
                        type="date"
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

                    <td style={{ ...tdStyle, fontSize: 10, whiteSpace: "nowrap" }}>
                      {row.checked_in_at ? (
                        <>
                          <span title={row.checked_in_at}>{formatArrivalTime(row)}</span>
                          {row.identity_corrected_at ? <small title={row.identity_corrected_at}>
                            {" *"}
                          </small> : null}
                          {row.checkin_source === "driver_qr" ? (
                            <>
                              <a href={`/warehouse/checkin/${row.id}`} target="_blank" rel="noreferrer"
                                style={driverQrStyle} title="Open location-verified driver details">
                                QR ✓ · {(row.movement_direction ?? "delivery").toUpperCase()} · {(row.material_type ?? "cotton").toUpperCase()}
                              </a>
                              {row.reference_number ? <small style={gateReferenceStyle} title={row.reference_number}>Ref: {row.reference_number}</small> : null}
                              {row.movement_direction === "pickup" && row.destination ? <small style={gateReferenceStyle} title={row.destination}>To: {row.destination}</small> : null}
                            </>
                          ) : null}
                          {row.has_bol_photo ? (
                            <a href={`/api/warehouse/checkin-bol/${row.id}`} target="_blank" rel="noreferrer"
                              style={bolPhotoLinkStyle} title="Open the driver's paperwork photo">
                              View paperwork
                            </a>
                          ) : null}
                        </>
                      ) : ""}
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
                      {row.matched_order_id ? (
                        <small style={orderNumberStyle} title={row.draft_status === "failed" ? "Possible McLeod match; review before delivery" : "Matched SCM order"}>
                          {row.draft_status === "failed" ? "Possible #" : "SCM #"}{row.matched_order_id}
                        </small>
                      ) : null}
                      {!row.matched_order_id && cottonSearching[row.id] ? <small style={orderNumberStyle}>Searching McLeod…</small> : null}
                      {!row.matched_order_id && !cottonSearching[row.id] && cottonMatches[row.id]?.length === 1 ?
                        <small style={orderNumberStyle}>Possible SCM #{cottonMatches[row.id][0].orderId} · confirm before delivery</small> : null}
                      {!row.matched_order_id && !cottonSearching[row.id] && cottonMatches[row.id]?.length === 0 ?
                        <small style={gateReferenceStyle}>No McLeod match · enter details manually</small> : null}
                      {!row.matched_order_id && cottonMatches[row.id]?.length > 1 ?
                        <div style={{ maxHeight: 140, overflowY: "auto" }}>
                          {cottonMatches[row.id].map((match) => <button key={match.orderId} type="button"
                            disabled={isReadOnlyRow(row)} onClick={() => chooseCottonMatch(row.id, match)}
                            style={{ ...smallActionButtonStyle, textAlign: "left", marginTop: 4 }}>
                            #{match.orderId} · {match.customer || "Unknown customer"} · {match.bolBC ?? "?"} B/C
                          </button>)}
                        </div> : null}
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

                    <td style={tdStyle}>
                      <input
                        type="text"
                        data-checkin-identity={row.id}
                        data-checkin-bol={row.id}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={row.bol_bc?.toString() ?? ""}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "");
                          const updated = applyRowUpdate(row.id, (current) => ({
                            ...current,
                            bol_bc: digits ? Number(digits) : null,
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
                    </td>

                    <td style={tdStyle}>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
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
                      <select
                        value={row.sub_location ?? "MAIN"}
                        onChange={(e) => {
                          const value = e.target.value || "MAIN";
                          const updated = applyRowUpdate(row.id, (current) => ({
                            ...current,
                            sub_location: value,
                          }));
                          if (updated) queueSaveRow(updated);
                        }}
                        onKeyDown={(e) => handleGridKeyDown(e, index, "sub_location")}
                        ref={(el) => registerCellRef(index, "sub_location", el)}
                        style={cellInputStyle}
                        disabled={isReadOnlyRow(row)}
                      >
                        {site.subLocations.map((sub) => (
                          <option key={sub} value={sub}>
                            {sub}
                          </option>
                        ))}
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
                        disabled={isReadOnlyRow(row)}
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
                            style={primaryButtonStyle}>Retry Save</button> : null)
                      ) : null}
                      {row.draft_status === "failed" ? (
                        <button type="button" onClick={() => void saveRowSnapshot(row)}
                          style={primaryButtonStyle}>Retry</button>
                      ) : null}
                      {!row.id.startsWith("local-") && ui.saveState === "error" ? (
                        <button type="button" onClick={() => void reloadRow(row.id)}
                          title="Discard unsaved edits and load the latest row" style={linkButtonStyle}>Reload</button>
                      ) : null}
                      {!isClosedRow(row) ? <button
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
                    </td>

                    <td style={statusDotCellStyle}>
                      <div title={row.draft_status} style={rowDotStyle(row)} />
                      <small>{row.id.startsWith("local-") ? "" : row.draft_status === "checked_in"
                        ? usesMcleodCheckin(row) ? "Waiting" : "Gate only"
                        : row.draft_status}</small>
                      {row.processing_error || ui.saveState === "error" ? (
                        <button type="button" title={row.processing_error || ui.message || "Save failed"}
                          aria-label="Show check-in error"
                          onClick={() => alert(row.processing_error || ui.message || "Save failed")}
                          style={errorButtonStyle}>View error</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={13} style={emptyStateStyle}>
                    {loading
                      ? "Loading rows..."
                      : viewCarryover ? "No earlier cotton check-ins need review." : "No check-ins yet. Add a blank line to check in a driver."}
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
    </main>
  );
}

function StatCard(props: {
  label: string;
  value: number | string;
  tone?: "default" | "success" | "info";
}) {
  const { label, value, tone = "default" } = props;

  const tones: Record<string, React.CSSProperties> = {
    default: {
      background: "linear-gradient(180deg, #111827 0%, #0f172a 100%)",
      border: "1px solid #1f2937",
      color: "#f8fafc",
    },
    success: {
      background:
        "linear-gradient(180deg, rgba(6,95,70,0.22) 0%, rgba(6,78,59,0.3) 100%)",
      border: "1px solid rgba(16,185,129,0.35)",
      color: "#d1fae5",
    },
    info: {
      background:
        "linear-gradient(180deg, rgba(30,64,175,0.22) 0%, rgba(30,58,138,0.3) 100%)",
      border: "1px solid rgba(96,165,250,0.35)",
      color: "#dbeafe",
    },
  };

  return (
    <div style={{ ...statCardStyle, ...tones[tone] }}>
      <div style={statLabelStyle}>{label}</div>
      <div style={statValueStyle}>{value}</div>
    </div>
  );
}

const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
};

const statCardStyle: React.CSSProperties = {
  borderRadius: 18,
  padding: 18,
  boxShadow: "0 10px 24px rgba(0,0,0,0.2)",
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.8,
  marginBottom: 10,
};

const statValueStyle: React.CSSProperties = {
  fontSize: 30,
  fontWeight: 900,
  lineHeight: 1,
  wordBreak: "break-word",
};

const rowNumberHeaderStyle: React.CSSProperties = {
  width: 34,
  minWidth: 34,
  textAlign: "center",
  padding: "6px 3px",
  color: "#94a3b8",
  fontSize: 11,
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

const statusDotHeaderStyle: React.CSSProperties = {
  width: 88,
  minWidth: 88,
  padding: "6px 4px",
  borderBottom: "1px solid rgba(148,163,184,0.16)",
  background: "rgba(15,23,42,0.96)",
  position: "sticky",
  top: 0,
  zIndex: 3,
};

const statusDotCellStyle: React.CSSProperties = {
  width: 88,
  minWidth: 88,
  padding: "4px 3px",
  borderBottom: "1px solid rgba(148,163,184,0.08)",
  verticalAlign: "middle",
  fontSize: 10,
  overflowWrap: "anywhere",
};

const errorButtonStyle: React.CSSProperties = {
  display: "block",
  marginTop: 3,
  padding: 0,
  border: 0,
  background: "transparent",
  color: "#fca5a5",
  fontSize: 10,
  cursor: "pointer",
  textDecoration: "underline",
};

const driverQrStyle: React.CSSProperties = {
  display: "block",
  marginTop: 2,
  color: "#67e8f9",
  fontSize: 9,
  fontWeight: 900,
  letterSpacing: ".05em",
};

const gateReferenceStyle: React.CSSProperties = {
  display: "block",
  marginTop: 2,
  color: "#94a3b8",
  fontSize: 8,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const bolPhotoLinkStyle: React.CSSProperties = {
  display: "block",
  marginTop: 2,
  color: "#a5b4fc",
  fontSize: 9,
  fontWeight: 800,
  textDecoration: "underline",
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
  padding: "6px 5px",
  color: "#94a3b8",
  fontSize: 11,
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(148,163,184,0.16)",
  background: "rgba(15,23,42,0.96)",
  position: "sticky",
  top: 0,
  zIndex: 2,
};

const tdStyle: React.CSSProperties = {
  padding: "4px 5px",
  borderBottom: "1px solid rgba(148,163,184,0.08)",
  verticalAlign: "top",
  color: "#e5e7eb",
};

const cellInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 30,
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
  width: "100%",
  padding: "3px 5px",
  borderRadius: 6,
  border: "1px solid rgba(148,163,184,0.35)",
  background: "rgba(30,41,59,0.9)",
  color: "#e2e8f0",
  fontSize: 11,
  cursor: "pointer",
};
