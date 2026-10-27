import { createHash } from "node:crypto";
import { staffDatabase } from "@/lib/auth/session";
import type { Ledger, Store, Vendor } from "./engine.ts";
export const hash = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
export function databaseStore(
  db: ReturnType<typeof staffDatabase>,
  actor: string,
): Store {
  async function transition(
    row: any,
    to: string,
    order: string | null,
    note: string,
  ) {
    const { data, error } = await db.rpc("transition_ecotton_import", {
      p_id: row.id,
      p_version: row.version,
      p_from: row.status,
      p_to: to,
      p_order: order,
      p_note: note,
      p_actor: actor,
    });
    if (error)
      throw new Error(
        "Import state could not be saved. Do not retry any vendor write.",
      );
    if (!data?.[0])
      throw new Error(
        "Import state changed in another request. Refresh the run.",
      );
    Object.assign(row, data[0]);
    return row;
  }
  return {
    claim: async (id, from, to) => {
      const { data: row, error } = await db
        .from("ecotton_import_orders")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw new Error("Import row unavailable.");
      if (row.status !== from) return null;
      try {
        return await transition(row, to, row.order_id, `Claimed ${to}`);
      } catch (e) {
        if ((e as Error).message.includes("another request")) return null;
        throw e;
      }
    },
    finish: async (row, state, order, note) => {
      await transition(row, state, order, note);
    },
  };
}
export function vendor(readOnly = false): Vendor {
  const readBase =
    process.env.MCLEOD_BILLING_READ_BASE_URL || process.env.MCLEOD_BASE_URL;
  const readToken =
    process.env.MCLEOD_BILLING_READ_AUTH_TOKEN || process.env.MCLEOD_AUTH_TOKEN;
  const writeBase = process.env.MCLEOD_BASE_URL,
    writeToken = process.env.MCLEOD_AUTH_TOKEN;
  async function request(path: string, method: string, body?: any) {
    const isRead = method === "GET",
      base = isRead ? readBase : writeBase,
      token = isRead ? readToken : writeToken;
    if (!base || !token)
      throw new Error("McLeod connection is not configured.");
    if (
      !isRead &&
      (readOnly ||
        process.env.ECOTTON_IMPORT_WRITES_ENABLED !== "true" ||
        process.env.MCLEOD_SYNC_ENABLED !== "true")
    )
      throw new Error(
        "eCotton creation and rating are disabled in this environment.",
      );
    // Read-only credentials are never passed to a write endpoint.
    if (
      isRead
        ? !/^\/orders(?:\/search\?|\/[A-Za-z0-9_-]+$)/.test(path)
        : !/^(?:\/orders\/(?:create|autorate\/[A-Za-z0-9_-]+)|\/movement\/update|\/carrierDispatch\/setPay\/[A-Za-z0-9_-]+\?method=F&units=1&rate=0&carrierPay=0)$/.test(
            path,
          )
    )
      throw new Error("Unsupported import operation.");
    const r = await fetch(base.replace(/\/$/, "") + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: path.startsWith("/carrierDispatch/setPay/")
          ? "text/plain, application/json"
          : "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    if (!r.ok)
      throw new Error(`McLeod HTTP ${r.status}: ${text.slice(0, 350)}`);
    if (path.startsWith("/carrierDispatch/setPay/")) return { raw: text };
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("McLeod returned an unreadable response.");
    }
  }
  return {
    read: (path) => request(path, "GET"),
    write: (path, body) =>
      request(
        path,
        ["/orders/create", "/movement/update"].includes(path) ? "PUT" : "POST",
        body,
      ),
  };
}
export async function readRun(
  db: ReturnType<typeof staffDatabase>,
  runId: string,
) {
  const { data: run, error } = await db
    .from("ecotton_import_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (error) throw new Error("Import run not found.");
  const { data: items, error: itemsError } = await db
    .from("ecotton_import_items")
    .select("*,order:ecotton_import_orders(*)")
    .eq("run_id", runId)
    .order("position");
  if (itemsError) throw new Error("Import rows unavailable.");
  return { run, items };
}
