import { connectSharePoint } from "./graph";

async function listPdfs(read: Awaited<ReturnType<typeof connectSharePoint>>["read"], drive: string, folders: string[]) {
  const path = folders.map(encodeURIComponent).join("/");
  let page = `${drive}/root:/${path}:/children?$select=name,file`;
  const names: string[] = [];
  try {
    while (page) {
      const result = await (await read(page)).json() as {
        value: { name: string; file?: object }[];
        "@odata.nextLink"?: string;
      };
      names.push(...result.value.filter((item) => item.file && /\.pdf$/i.test(item.name)).map((item) => item.name));
      page = result["@odata.nextLink"] ?? "";
    }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Graph HTTP 404" || names.length) throw error;
  }
  return names.sort();
}

const interchangePath = (booking: string) => ["Savannah Interchanges", "Exports", booking];
export async function listSavannahInterchanges(booking: string) {
  const { read, getDrive } = await connectSharePoint();
  return listPdfs(read, await getDrive(), interchangePath(booking));
}

export async function findSavannahInterchangeBookings(container: string) {
  if (!/^[A-Z]{4}\d{7}$/.test(container)) throw Error("Enter the full container number including its check digit.");
  const { read, getDrive } = await connectSharePoint();
  const drive = await getDrive();
  const folderPath = interchangePath("").slice(0, -1).map(encodeURIComponent).join("/");
  const folder = await (await read(`${drive}/root:/${folderPath}?$select=id`)).json() as { id?: string };
  if (!folder.id) throw Error("Savannah export interchange folder could not be resolved.");
  let page = `${drive}/items/${encodeURIComponent(folder.id)}/search(q='${container}')?$select=name,file,parentReference,webUrl&$top=50`;
  const matches = new Map<string, { booking: string; inbound: string | null; outbound: string | null }>();
  const seen = new Set<string>();
  while (page) {
    if (seen.has(page) || seen.size >= 10) throw Error("Interchange search did not complete. Try again in SharePoint.");
    seen.add(page);
    const result = await (await read(page)).json() as {
      value: { name: string; file?: object; parentReference?: { path?: string }; webUrl?: string }[];
      "@odata.nextLink"?: string;
    };
    for (const item of result.value) {
      if (!item.file || !item.webUrl) continue;
      const direction = item.name.toUpperCase() === `${container}_IN.PDF` ? "inbound"
        : item.name.toUpperCase() === `${container}_OUT.PDF` ? "outbound" : null;
      if (!direction) continue;
      const url = new URL(item.webUrl);
      if (url.origin !== "https://scmllcnet.sharepoint.com") continue;
      const path = decodeURIComponent(item.parentReference?.path || url.pathname);
      const booking = /\/Savannah Interchanges\/Exports\/([A-Z0-9_-]+)(?:\/[^/]+\.pdf)?$/i.exec(path)?.[1];
      if (!booking) continue;
      const match = matches.get(booking) ?? { booking, inbound: null, outbound: null };
      match[direction] = item.webUrl;
      matches.set(booking, match);
    }
    page = result["@odata.nextLink"] ?? "";
  }
  return [...matches.values()].sort((a,b) => a.booking.localeCompare(b.booking));
}

export async function findE2openDocuments(bookingNumber: string, containers: string[]) {
  const { read, getDrive } = await connectSharePoint();
  const drive = await getDrive();
  const [bols, interchanges] = await Promise.all([
    listPdfs(read, drive, ["Sav Cotton Bols", bookingNumber]),
    listPdfs(read, drive, interchangePath(bookingNumber)),
  ]);
  const byName = new Map(interchanges.map((name) => [name.toUpperCase(), name]));
  return {
    bols,
    containers: containers.map((container) => ({
      container,
      inbound: byName.get(`${container}_IN.PDF`) ?? null,
      outbound: byName.get(`${container}_OUT.PDF`) ?? null,
    })),
  };
}
