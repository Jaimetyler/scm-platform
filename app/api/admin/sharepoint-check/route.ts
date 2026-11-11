import { connectSharePoint, GraphTokenError } from "@/lib/sharepoint/graph";
import { NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export const GET = withStaffAccess(async () => {
  let step = "Vercel OIDC";
  try {
    const { read, getDrive } = await connectSharePoint(() => { step = "Entra token exchange"; });
    step = "Resolve SharePoint root site";
    const drive = await getDrive();
    step = "List Sav Cotton Bols";
    type DriveItem = { id: string; name: string; file?: object; folder?: object };
    const pendingPages = [`${drive}/root:/Sav%20Cotton%20Bols:/children?$select=id,name,file,folder`];
    let pdf: DriveItem | undefined;
    let foldersFound = 0;
    let filesFound = 0;
    let pagesScanned = 0;
    const deadline = Date.now() + 20_000;
    while (pendingPages.length && !pdf && pagesScanned < 50 && Date.now() < deadline) {
      const listing = await (await read(pendingPages.shift()!)).json() as {
        value: DriveItem[];
        "@odata.nextLink"?: string;
      };
      pagesScanned++;
      if (listing["@odata.nextLink"]) pendingPages.unshift(listing["@odata.nextLink"]);
      for (const item of listing.value) {
        if (item.file) {
          filesFound++;
          if (item.name.toLowerCase().endsWith(".pdf")) {
            pdf = item;
            break;
          }
        }
        if (item.folder) {
          foldersFound++;
          pendingPages.push(`${drive}/items/${encodeURIComponent(item.id)}/children?$select=id,name,file,folder`);
        }
      }
    }
    if (!pdf) {
      const reason = pendingPages.length ? "Search limit reached before finding a PDF" : "No PDF found in the folder or its subfolders";
      return NextResponse.json({ ok: false, step, reason, filesFound, foldersFound, pagesScanned }, { status: 404 });
    }
    step = "Download and verify PDF";
    const bytes = Buffer.from(await (await read(`${drive}/items/${encodeURIComponent(pdf.id)}/content`)).arrayBuffer());
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("Invalid PDF");
    return NextResponse.json({ ok: true, folder: "Sav Cotton Bols", bytesVerified: bytes.length });
  } catch (error) {
    if (error instanceof GraphTokenError) return NextResponse.json({ ok: false, step, upstreamStatus: error.status, entraCodes: error.codes }, { status: 502 });
    const upstreamStatus = error instanceof Error && /^Graph HTTP (\d{3})$/.exec(error.message);
    return NextResponse.json({ ok: false, step, ...(upstreamStatus && { upstreamStatus: Number(upstreamStatus[1]) }) }, { status: 502 });
  }
});
