"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TERMINAL_NAMES } from "@/lib/inbound/checkin/sites";
import { canUseInboundImporter } from "@/lib/auth/policy";
import { useStaff } from "@/components/auth/StaffSession";
import { useWarehouseWorkspace } from "./WarehouseWorkspace";
import { availableCheckinViews, sitesForLocation, workspaceHref, type WarehouseSection } from "@/lib/warehouse/navigation";

export default function WarehouseHub({ section = "overview" }: { section?: WarehouseSection }) {
  const staff = useStaff();
  const requestedView = useSearchParams().get("view");
  const view = ["line", "cotton", "domestic", "containers"].includes(requestedView || "") ? requestedView as "line" | "cotton" | "domestic" | "containers" : undefined;
  const { location, ready } = useWarehouseWorkspace();
  const sites = sitesForLocation(location).filter((site) => (section !== "inventory" || site.materials.includes("cotton")) && (section !== "checkins" || !view || availableCheckinViews({terminal: site.terminal, siteCode: site.siteCode}).some(item => item.key === view)));

  if (section !== "overview") {
    const titles = { overview: "Operations", rates: "Rates", carriers: "Carrier rates", checkins: "Check-in sheets", inventory: "Inventory / Marks", outbound: "Outbound bookings", history: "Check-in history" };
    return <main className="warehouse-hub">
      <h1>{titles[section]}</h1>
      <p>{section === "inventory" ? "Choose a cotton warehouse to review marks, available bales, allocations, and receipt status."
        : section === "history" ? "Choose a warehouse to search completed or removed check-ins and export the results."
        : "Choose a warehouse to open its check-in sheet."}</p>
      {!ready ? <p>Loading your workspace…</p> : sites.length ? <div className="warehouse-hub-grid">{sites.map((site) =>
        <Link key={`${site.terminal}:${site.siteCode}`} href={workspaceHref(section, { terminal: site.terminal, siteCode: site.siteCode }, view)} className="warehouse-hub-card">
          <strong>{site.siteName}</strong>
          {section !== "checkins" && <span>{section === "history" ? "Completed and removed arrivals" : "Cotton inventory"}</span>}
          <span className="warehouse-hub-action">Open →</span>
        </Link>)}</div> : <p>This location does not handle cotton inventory. Select another warehouse above to view its marks.</p>}
    </main>;
  }

  return <main className="warehouse-hub warehouse-operations">
    <div className="warehouse-operations-heading"><h1>Operations</h1></div>
    {!ready ? <p>Loading your workspace…</p> : sites.length ? <div className="warehouse-operations-list">{sites.map((site) => {
      const siteLocation = { terminal: site.terminal, siteCode: site.siteCode };
      const views = availableCheckinViews(siteLocation);
      const importerTerminal = { DAL: "dallas", HOU: "houston", SAV: "savannah" }[site.terminal];
      return <section key={`${site.terminal}:${site.siteCode}`} className="warehouse-operation-row">
        <div className="warehouse-operation-site">
          <span className="warehouse-operation-terminal">{TERMINAL_NAMES[site.terminal]}</span>
          <strong>{site.displayCode ?? site.siteCode}</strong>
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
          {site.materials.includes("cotton") && <>
            {canUseInboundImporter(staff) &&
              <Link href={`/bunge-import?terminal=${importerTerminal}`}>Inbound Cotton Importer</Link>}
            <Link href={workspaceHref("inventory", siteLocation)}>Inventory</Link>
            <Link href={workspaceHref("outbound", siteLocation)}>Outbound bookings</Link>
          </>}
          <Link href={workspaceHref("history", siteLocation)}>History</Link>
        </div>
      </section>;
    })}</div> : <div className="warehouse-empty-state"><strong>No sites match this view.</strong><span>Select another terminal or All locations above.</span></div>}

  </main>;
}
