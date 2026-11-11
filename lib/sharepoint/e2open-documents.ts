import { connectSharePoint } from "./graph";

export async function findE2openDocuments(bookingNumber: string, containers: string[]) {
  const { read, getDrive } = await connectSharePoint();
  const drive = await getDrive();
  async function listPdfs(folders: string[]) {
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
  const [bols, interchanges] = await Promise.all([
    listPdfs(["Sav Cotton Bols", bookingNumber]),
    listPdfs(["Savannah Interchanges", "Exports", bookingNumber]),
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
