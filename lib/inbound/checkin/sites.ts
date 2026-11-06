export type TerminalCode = "SAV" | "HOU" | "DAL";

export const TERMINAL_NAMES = { SAV: "Savannah", HOU: "Houston", DAL: "Dallas" } as const;

export type CheckinSite = {
  terminal: TerminalCode;
  terminalSlug: "sav" | "hou" | "dal";
  siteCode: string;
  siteName: string;
  subLocations: string[];
  materials: ("cotton" | "lumber" | "other")[];
  containers: boolean;
};

export const CHECKIN_SITES: CheckinSite[] = [
  {
    terminal: "DAL", terminalSlug: "dal", siteCode: "SCMDDETX",
    siteName: "Dallas - DeSoto (SCMDDETX)", subLocations: ["MAIN"],
    materials: ["cotton", "lumber", "other"], containers: false,
  },
  {
    terminal: "DAL", terminalSlug: "dal", siteCode: "SCMDDATX",
    siteName: "Dallas - SCMDDATX", subLocations: ["MAIN"],
    materials: ["cotton", "lumber", "other"], containers: false,
  },
  {
    terminal: "SAV",
    terminalSlug: "sav",
    siteCode: "1601",
    siteName: "Savannah - 1601",
    subLocations: ["MAIN"],
    materials: ["lumber", "other"],
    containers: true,
  },
  {
    terminal: "SAV",
    terminalSlug: "sav",
    siteCode: "246",
    siteName: "Savannah - 246",
    subLocations: ["MAIN"],
    materials: ["cotton"],
    containers: false,
  },
  {
    terminal: "SAV",
    terminalSlug: "sav",
    siteCode: "984",
    siteName: "Savannah - 984",
    subLocations: ["MAIN", "982B"],
    materials: ["cotton"],
    containers: false,
  },
  {
    terminal: "SAV",
    terminalSlug: "sav",
    siteCode: "175",
    siteName: "Savannah - 175",
    subLocations: ["MAIN"],
    materials: ["cotton"],
    containers: false,
  },
  {
    terminal: "HOU",
    terminalSlug: "hou",
    siteCode: "5300",
    siteName: "Houston - 5300",
    subLocations: ["MAIN"],
    materials: ["cotton", "lumber", "other"],
    containers: true,
  },
  {
    terminal: "HOU",
    terminalSlug: "hou",
    siteCode: "4331",
    siteName: "Houston - 4331",
    subLocations: ["MAIN"],
    materials: ["cotton", "lumber", "other"],
    containers: true,
  },
];

export function getCheckinSite(
  terminalSlug: string,
  siteCode: string
): CheckinSite | null {
  return (
    CHECKIN_SITES.find(
      (site) =>
        site.terminalSlug === terminalSlug.toLowerCase() &&
        site.siteCode === siteCode
    ) ?? null
  );
}


export function eligibleCheckinRevenue(revenue: unknown, terminal?: string) {
  const code = String(revenue ?? "").trim().toUpperCase();
  return code === "MAIN" || (terminal === "DAL" && code === "DAVIS");
}
