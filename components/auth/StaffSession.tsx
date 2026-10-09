"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useVisiblePolling } from "@/components/warehouse/useVisiblePolling";
import type { Staff } from "@/lib/auth/policy";
import "./staff.css";
const Context = createContext<Staff | null>(null);
export const useStaff = () => useContext(Context);
export function useCanWrite(terminal?: string) {
  const staff = useStaff();
  return staff?.role === "admin" || staff?.role === "operator" && terminal?.toUpperCase() === staff.terminal;
}
export default function StaffSession({ children }: { children: ReactNode }) {
  const path = usePathname();
  const publicPage = path.startsWith("/gate/check-in/") || path.startsWith("/auth/") || ["/login", "/access-denied"].includes(path);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { if (publicPage) { setStaff(null); setUnavailable(false); } }, [publicPage]);
  const polling = useVisiblePolling({ enabled: !publicPage, intervalMs: 60_000,
    load: async (signal) => {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
        const result = await response.json();
        if (signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setStaff(null); location.assign(response.status === 401 ? "/login" : "/access-denied"); return;
        }
        if (!response.ok) throw new Error("Staff access is temporarily unavailable.");
        setStaff(result.staff); setUnavailable(false);
      } catch (error) {
        if (!signal.aborted) setUnavailable(true);
        throw error;
      }
    },
  });
  async function logout() {
    const response = await fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    if (response.ok) location.assign("/login");
  }
  return <Context.Provider value={staff}>{!publicPage && <div className="staff-bar">
    <span>{staff ? `${staff.name} · ${staff.role === "operator" ? `${staff.terminal === "HOU" ? "Houston" : "Savannah"} operator` : staff.role === "viewer" ? "Read-only" : "Administrator"}` : "Loading staff account…"}</span>
    {unavailable && <span role="status">Staff access could not be refreshed. Your work is still here. <button disabled={polling.refreshing} onClick={() => void polling.refresh()}>Try again</button></span>}
    {staff?.role === "admin" && <Link href="/admin/users">Manage users</Link>}
    <button onClick={()=>void logout()}>Sign out</button>
  </div>}{children}</Context.Provider>;
}
