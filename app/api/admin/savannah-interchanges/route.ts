import { NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { listInterchangeRuns, runSavannahInterchanges } from "@/lib/interchanges/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withStaffAccess(async () => NextResponse.json({runs:await listInterchangeRuns()}));
export const POST = withStaffAccess(async () => NextResponse.json({run:await runSavannahInterchanges()}));
