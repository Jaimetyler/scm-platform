"use client";
import Link from "next/link";
import { useWarehouseWorkspace } from "./WarehouseWorkspace";
import { availableCheckinViews, sitesForLocation, workspaceHref, type WarehouseSection } from "@/lib/warehouse/navigation";

export default function WarehouseHub({ section = "overview" }: { section?: WarehouseSection }) {
  const { location, ready } = useWarehouseWorkspace();
  const sites = sitesForLocation(location).filter((site) => section !== "inventory" || site.materials.includes("cotton"));

  if (section !== "overview") {
    const titles = { overview: "Operations", checkins: "Check-in sheets", inventory: "Inventory / Marks", outbound: "Outbound bookings", history: "Check-in history" };
    return <main className="warehouse-hub">
      <h1>{titles[section]}</h1>
      <p>{section === "inventory" ? "Choose a cotton warehouse to review marks, available bales, allocations, and receipt status."
        : section === "history" ? "Choose a warehouse to search completed or removed check-ins and export the results."
        : "Choose a warehouse to open its check-in sheet."}</p>
      {!ready ? <p>Loading your workspace…</p> : sites.length ? <div className="warehouse-hub-grid">{sites.map((site) =>
        <Link key={`${site.terminal}:${site.siteCode}`} href={workspaceHref(section, { terminal: site.terminal, siteCode: site.siteCode })} className="warehouse-hub-card">
          <strong>{site.siteName}</strong>
          <span>{section === "checkins" ? `${site.materials.includes("cotton") ? "Cotton" : "Lumber / FAK"}${site.containers ? " · Containers" : ""}` : section === "history" ? "Completed and removed arrivals" : "Cotton inventory"}</span>
          <span className="warehouse-hub-action">Open →</span>
        </Link>)}</div> : <p>This location does not handle cotton inventory. Select another warehouse above to view its marks.</p>}
    </main>;
  }

  return <main className="warehouse-hub warehouse-operations">
    <div className="warehouse-operations-heading">
      <div><div className="warehouse-eyebrow">Live workspace</div><h1>Operations</h1>
        <p>Pick the site you are working and go straight to the freight. Existing check-in screens stay underneath this board.</p></div>
      <Link href="/warehouse/gate" className="warehouse-secondary-action">Driver QR setup</Link>
    </div>
    {!ready ? <p>Loading your workspace…</p> : sites.length ? <div className="warehouse-operations-list">{sites.map((site) => {
      const siteLocation = { terminal: site.terminal, siteCode: site.siteCode };
      const views = availableCheckinViews(siteLocation);
      return <section key={`${site.terminal}:${site.siteCode}`} className="warehouse-operation-row">
        <div className="warehouse-operation-site">
          <span className="warehouse-operation-terminal">{site.terminal === "SAV" ? "Savannah" : "Houston"}</span>
          <strong>{site.siteCode}</strong>
          <span className="warehouse-operation-materials">{[
            site.materials.includes("cotton") ? "Cotton" : null,
            site.materials.includes("lumber") ? "Lumber / FAK" : null,
            site.containers ? "Containers" : null,
          ].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="warehouse-operation-actions">{views.map((view) =>
          <Link key={view.key} href={view.href} className={view.key === "line" ? "warehouse-primary-action" : "warehouse-work-action"}>
            {view.label}<span aria-hidden="true">→</span>
          </Link>)}</div>
        <div className="warehouse-operation-tools">
          {site.materials.includes("cotton") && <Link href={workspaceHref("inventory", siteLocation)}>Inventory</Link>}
          <Link href={workspaceHref("history", siteLocation)}>History</Link>
        </div>
      </section>;
    })}</div> : <div className="warehouse-empty-state"><strong>No sites match this view.</strong><span>Select Savannah, Houston, or All locations above.</span></div>}
    <div className="warehouse-operations-note"><strong>Safe first pass:</strong> this is a navigation-only operations layer. Cotton processing, McLeod lookups, Domestic Line, driver check-in, checkout, and container behavior are unchanged.</div>
  </main>;
}
