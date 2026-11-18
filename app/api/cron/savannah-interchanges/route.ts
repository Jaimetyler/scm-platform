import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { repairSavannahInterchangeRun, runSavannahInterchanges } from "@/lib/interchanges/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  return !!secret && expected.length === supplied.length && timingSafeEqual(expected,supplied);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
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

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const {id} = await request.json();
    if (id !== "2026-11-18T11-47-39-437Z") return NextResponse.json({error:"Unsupported repair run."},{status:400});
    const run = await repairSavannahInterchangeRun(id);
    return NextResponse.json({
      id:run.id, status:run.status, repaired:run.files.filter(file=>file.status === "repaired").length,
      failed:run.files.filter(file=>file.status === "failed").length,
      failures:run.files.filter(file=>file.status === "failed").slice(0,3),
    },{status:run.status === "complete" ? 200 : 502});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : "Repair failed."},{status:502});
  }
}
