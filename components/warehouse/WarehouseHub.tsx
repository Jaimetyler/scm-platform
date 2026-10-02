"use client";
import Link from "next/link";
import { useWarehouseWorkspace } from "./WarehouseWorkspace";
import { sitesForLocation, workspaceHref, type WarehouseSection } from "@/lib/warehouse/navigation";

export default function WarehouseHub({ section = "overview" }: { section?: WarehouseSection }) {
  const { location, ready, href } = useWarehouseWorkspace();
  const titles = { overview: "Warehouse dashboard", checkins: "Check-in sheets", inventory: "Inventory / Marks", outbound: "Outbound bookings", history: "Check-in history" };
  const sites = sitesForLocation(location).filter((site) => section !== "inventory" || site.materials.includes("cotton"));
  return <main className="warehouse-hub">
    <h1>{titles[section]}</h1>
    <p>{section === "overview" ? "Open the next part of your warehouse work. Your location stays selected as you move between pages."
      : section === "inventory" ? "Choose a cotton warehouse to review marks, available bales, allocations, and receipt status."
      : section === "history" ? "Choose a warehouse to search completed or removed check-ins and export the results."
      : "Choose a warehouse to open its check-in sheet. Switch freight views using the tabs above the sheet."}</p>
    {!ready ? <p>Loading your workspace…</p> : section === "overview" ? <div className="warehouse-hub-grid">
      {([
        ["checkins", "Check-ins", "Cotton, domestic freight, and container queues."],
        ["inventory", "Inventory / Marks", "Received cotton, available bales, and booking allocations."],
        ["outbound", "Outbound bookings", "Booking cards, missing marks, ERDs, and sailing cutoffs."],
        ["history", "History", "Completed check-ins, searches, and Excel exports."],
      ] as const).map(([key, title, description]) => <Link key={key} href={href(key)} className="warehouse-hub-card">
        <strong>{title}</strong><span>{description}</span><span className="warehouse-hub-action">Open {title.toLowerCase()} →</span>
      </Link>)}
    </div> : sites.length ? <div className="warehouse-hub-grid">{sites.map((site) =>
      <Link key={`${site.terminal}:${site.siteCode}`} href={workspaceHref(section, { terminal: site.terminal, siteCode: site.siteCode })} className="warehouse-hub-card">
        <strong>{site.siteName}</strong><span>{section === "checkins" ? `${site.materials.includes("cotton") ? "Cotton" : "Lumber / FAK"}${site.containers ? " · Containers" : ""}` : section === "history" ? "Completed and removed arrivals" : "Cotton inventory"}</span>
        <span className="warehouse-hub-action">Open →</span>
      </Link>)}</div> : <p>This location does not handle cotton inventory. Select another warehouse above to view its marks.</p>}
  </main>;
}
