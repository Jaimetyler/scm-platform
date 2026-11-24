import * as XLSX from "xlsx";
import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { previewToyoSourceLoads } from "@/lib/warehouse/outbound/source-loads";

export const runtime = "nodejs";

export const POST = withStaffAccess(async (req: NextRequest) => {
  try {
    if (Number(req.headers.get("content-length")) > 3 * 1024 * 1024 + 65536)
      throw Error("Maximum workbook size is 3 MB.");
    const file = (await req.formData()).get("file");
    if (!(file instanceof File) || !file.size || file.size > 3 * 1024 * 1024 || !/\.xlsx$/i.test(file.name))
      throw Error("Choose an XLSX workbook up to 3 MB.");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, sheets: 0 });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw Error("No dispatch sheet found.");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true, defval: "" });
    const { data, error } = await staffDatabase().from("cotton_location_master")
      .select("id,mcleod_code,prev_code,name,timezone,active,city,state").limit(3000);
    if (error) return NextResponse.json({ error: "Could not load the cotton location master." }, { status: 503 });
    return NextResponse.json(previewToyoSourceLoads(rows, data ?? []), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not preview the dispatch." }, { status: 400 });
  }
});
