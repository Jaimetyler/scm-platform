import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runSavannahInterchanges } from "@/lib/interchanges/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (!secret || expected.length !== supplied.length || !timingSafeEqual(expected,supplied)) {
    return NextResponse.json({error:"Unauthorized"},{status:401});
  }
  try {
    const run = await runSavannahInterchanges();
    return NextResponse.json({
      status:run.status, id:run.id, source:run.source, error:run.error,
      counts:Object.fromEntries(["created","exists","failed"].map(status=>[status,run.files.filter(file=>file.status === status).length])),
      failures:run.files.filter(file=>file.status === "failed").slice(0,3),
    },{status:["failed","partial"].includes(run.status) ? 502 : 200});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : "Interchange service unavailable"},{status:502});
  }
}
