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

type GraphItem = { id?: string; name: string; file?: object; folder?: object; parentReference?: { path?: string }; webUrl?: string };
type GraphRead = Awaited<ReturnType<typeof connectSharePoint>>["read"];
type InterchangeBooking = { booking: string; inbound: string | null; outbound: string | null };

async function readInterchangeItems(read: GraphRead, page: string) {
  const items: GraphItem[] = [];
  const seen = new Set<string>();
  while (page) {
    if (seen.has(page) || seen.size >= 20) throw Error("Interchange lookup did not complete. Try again in SharePoint.");
    seen.add(page);
    const result = await (await read(page)).json() as { value: GraphItem[]; "@odata.nextLink"?: string };
    items.push(...result.value);
    page = result["@odata.nextLink"] ?? "";
  }
  return items;
}

function roundedBookingRange(booking: string) {
  const match = /^(\d)\.(\d{2,14})E\+(\d{1,2})$/i.exec(booking.trim());
  if (!match) return null;
  const power = Number(match[3]) - match[2].length;
  if (power < 1 || power > 15) return null;
  const step = BigInt(10) ** BigInt(power);
  const midpoint = BigInt(match[1] + match[2]) * step;
  return { lower:midpoint-step/BigInt(2), upper:midpoint+step/BigInt(2) };
}

export async function findSavannahInterchangeBookings(container: string, sourceBooking = "", preferSavedBooking = false) {
  if (!/^[A-Z]{4}\d{7}$/.test(container)) throw Error("Enter the full container number including its check digit.");
  const { read, getDrive } = await connectSharePoint();
  const drive = await getDrive();
  const folderPath = interchangePath("").slice(0, -1).map(encodeURIComponent).join("/");
  const matches = new Map<string, InterchangeBooking>();
  function addFiles(items: GraphItem[], knownBooking?: string) {
    for (const item of items) {
      if (!item.file || !item.webUrl) continue;
      const direction = item.name.toUpperCase() === `${container}_IN.PDF` ? "inbound"
        : item.name.toUpperCase() === `${container}_OUT.PDF` ? "outbound" : null;
      if (!direction) continue;
      const url = new URL(item.webUrl);
      if (url.origin !== "https://scmllcnet.sharepoint.com") continue;
      const path = decodeURIComponent(item.parentReference?.path || url.pathname);
      const booking = knownBooking ?? /\/Savannah Interchanges\/Exports\/([A-Z0-9_-]+)(?:\/[^/]+\.pdf)?$/i.exec(path)?.[1];
      if (!booking) continue;
      const match = matches.get(booking) ?? { booking, inbound: null, outbound: null };
      match[direction] = item.webUrl;
      matches.set(booking, match);
    }
  }
  const booking = sourceBooking.trim();
  if (preferSavedBooking && /^[A-Z0-9_-]+$/i.test(booking)) {
    const path = interchangePath(booking).map(encodeURIComponent).join("/");
    try {
      addFiles(await readInterchangeItems(read, `${drive}/root:/${path}:/children?$select=name,file,webUrl&$top=200`), booking);
      if (matches.size) return [...matches.values()];
    } catch (error) {
      if (!(error instanceof Error) || !/^Graph HTTP (404|500|502|503|504)$/.test(error.message)) throw error;
    }
  }
  const range = roundedBookingRange(sourceBooking);
  try {
    const folder = await (await read(`${drive}/root:/${folderPath}?$select=id`)).json() as { id?: string };
    if (!folder.id) throw Error("Savannah export interchange folder could not be resolved.");
    const folderUrl = `${drive}/items/${encodeURIComponent(folder.id)}`;
    addFiles(await readInterchangeItems(read, `${folderUrl}/search(q='${container}')?$select=name,file,parentReference,webUrl&$top=50`));
  } catch (error) {
    if (!range || !(error instanceof Error) || !/^Graph HTTP (403|404|500|502|503)$/.test(error.message)) throw error;
  }
  if (!matches.size && range) {
    const folders = await readInterchangeItems(read, `${drive}/root:/${folderPath}:/children?$select=id,name,folder&$top=200`);
    const candidates = folders.filter(item => {
      if (!item.id || !item.folder || !/^\d{1,25}$/.test(item.name)) return false;
      const booking = BigInt(item.name);
      return booking >= range.lower && booking <= range.upper;
    });
    for (let index=0; index<candidates.length; index+=5) {
      await Promise.all(candidates.slice(index,index+5).map(async item => {
        const files = await readInterchangeItems(read, `${drive}/items/${encodeURIComponent(item.id!)}/children?$select=name,file,webUrl&$top=200`);
        addFiles(files,item.name);
      }));
    }
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

export async function readSavannahInterchangePdfs(booking: string, container: string) {
  if (!/^[A-Z0-9_-]+$/i.test(booking) || !/^[A-Z]{4}\d{7}$/.test(container)) {
    throw Error("Invalid interchange booking or container.");
  }
  const {read, getDrive} = await connectSharePoint();
  const drive = await getDrive();
  return Promise.all(["in", "out"].map(async direction => {
    const path = [...interchangePath(booking), `${container}_${direction}.pdf`].map(encodeURIComponent).join("/");
    const response = await read(`${drive}/root:/${path}:/content`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 10_000_000 || bytes.subarray(0, 5).toString() !== "%PDF-") {
      throw Error(`Invalid or oversized ${direction}gate PDF.`);
    }
    return {direction: `${direction}gate`, bytes};
  }));
}
