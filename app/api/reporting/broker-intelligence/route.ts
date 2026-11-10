import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffActor } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { validSnapshot, MAX_SNAPSHOT_BYTES } from "@/lib/reporting/broker-snapshot";

export const POST = withStaffAccess(async (req: NextRequest) => {
  if (Number(req.headers.get("content-length")) > MAX_SNAPSHOT_BYTES) {
    return NextResponse.json({ error: "Choose a snapshot smaller than 3 MB." }, { status: 413 });
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_SNAPSHOT_BYTES) {
    return NextResponse.json({ error: "Choose a snapshot smaller than 3 MB." }, { status: 413 });
  }
  let body: unknown;
  try { body = JSON.parse(text); } catch {
    return NextResponse.json({ error: "Invalid snapshot JSON." }, { status: 400 });
  }
  const input = body as { snapshot?: unknown; filename?: unknown } | null;
  if (!validSnapshot(input?.snapshot)) {
    return NextResponse.json({ error: "This is not a supported brokerage snapshot." }, { status: 400 });
  }
  const updatedAt = new Date().toISOString();
  const { error } = await staffDatabase().from("broker_intelligence_snapshots").upsert({
    id: "current", payload: input.snapshot,
    source_name: typeof input.filename === "string" ? input.filename.slice(0, 200) : "Brokerage snapshot",
    updated_at: updatedAt, updated_by: staffActor(req),
  }, { onConflict: "id" });
  if (error) {
    console.error("Unable to save brokerage snapshot:", error);
    return NextResponse.json({ error: "Unable to save snapshot. Your previous data is unchanged." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, updatedAt });
});
