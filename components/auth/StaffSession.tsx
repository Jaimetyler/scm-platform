"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
  useEffect(() => {
    if (publicPage) { setStaff(null); return; }
    let live = true;
    async function refresh() {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const result = await response.json();
      if (!live) return;
      if (!response.ok) { location.assign(response.status === 401 ? "/login" : "/access-denied"); return; }
      setStaff(result.staff);
    }
    const run = () => { void refresh().catch(() => { /* Next request remains protected by the server. */ }); };
    run(); window.addEventListener("focus", run); const timer = window.setInterval(run, 60000);
    return () => { live = false; window.removeEventListener("focus", run); window.clearInterval(timer); };
  }, [publicPage]);
  async function logout() {
    const response = await fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    if (response.ok) location.assign("/login");
  }
  return <Context.Provider value={staff}>{!publicPage && <div className="staff-bar">
    <span>{staff ? `${staff.name} · ${staff.role === "operator" ? `${staff.terminal === "HOU" ? "Houston" : "Savannah"} operator` : staff.role === "viewer" ? "Read-only" : "Administrator"}` : "Loading staff account…"}</span>
    {staff?.role === "admin" && <Link href="/admin/users">Manage users</Link>}
    <button onClick={()=>void logout()}>Sign out</button>
  </div>}{children}</Context.Provider>;
}
