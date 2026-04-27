export type TerminalCode = "SAV" | "HOU";

export type CheckinSite = {
  terminal: TerminalCode;
  terminalSlug: "sav" | "hou";
  siteCode: string;
  siteName: string;
  subLocations: string[];
};

export const CHECKIN_SITES: CheckinSite[] = [
  {
    terminal: "SAV",
    terminalSlug: "sav",
    siteCode: "1701",
    siteName: "Savannah - 1701",
    subLocations: ["MAIN"],
  },
  {
    terminal: "SAV",
    terminalSlug: "sav",
    siteCode: "246",
    siteName: "Savannah - 246",
    subLocations: ["MAIN"],
  },
  {
    terminal: "SAV",
    terminalSlug: "sav",
    siteCode: "984",
    siteName: "Savannah - 984",
    subLocations: ["MAIN", "982B"],
  },
  {
    terminal: "SAV",
    terminalSlug: "sav",
    siteCode: "175",
    siteName: "Savannah - 175",
    subLocations: ["MAIN"],
  },
  {
    terminal: "HOU",
    terminalSlug: "hou",
    siteCode: "5300",
    siteName: "Houston - 5300",
    subLocations: ["MAIN"],
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