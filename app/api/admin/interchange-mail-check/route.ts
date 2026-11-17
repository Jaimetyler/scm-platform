import { NextResponse } from "next/server";
import { staffProfile, withStaffAccess } from "@/lib/auth/guard";
import { connectSharePoint, GraphTokenError } from "@/lib/sharepoint/graph";

export const dynamic = "force-dynamic";
const folderName = "SCMI Sav Truck Transactions";
const headers = { "Cache-Control": "private, no-store" };

type GraphPage<T> = { value: T[]; "@odata.nextLink"?: string };
type MailFolder = { id: string; displayName: string; childFolderCount: number };

export const GET = withStaffAccess(async request => {
  const mailbox = staffProfile(request)?.email;
  if (!mailbox) return NextResponse.json({ ok: false }, { status: 401, headers });
  let step = "Connect to Graph";
  const deadline = Date.now() + 20_000;
  try {
    const { read } = await connectSharePoint();
    const user = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}`;
    step = "Find Outlook report folder";
    const fields = "$select=id,displayName,childFolderCount";
    const pending = [`${user}/mailFolders?${fields}`];
    const matches: MailFolder[] = [];
    for (let pages = 0; pending.length && pages < 30 && Date.now() < deadline; pages++) {
      const page = await (await read(pending.shift()!)).json() as GraphPage<MailFolder>;
      if (page["@odata.nextLink"]) pending.unshift(page["@odata.nextLink"]);
      for (const folder of page.value) {
        if (folder.displayName.toLowerCase() === folderName.toLowerCase()) matches.push(folder);
        if (folder.childFolderCount) pending.push(`${user}/mailFolders/${encodeURIComponent(folder.id)}/childFolders?${fields}`);
      }
    }
    if (matches.length !== 1 || pending.length)
      return NextResponse.json({ ok: false, step, matches: matches.length, scanComplete: !pending.length }, { status: 404, headers });

    step = "Check recent report attachments";
    const folder = `${user}/mailFolders/${encodeURIComponent(matches[0].id)}`;
    const messages = await (await read(`${folder}/messages?$select=id,hasAttachments&$top=20&$orderby=receivedDateTime%20desc`)).json() as GraphPage<{ id: string; hasAttachments: boolean }>;
    for (const message of messages.value.filter(item => item.hasAttachments).slice(0, 5)) {
      const path = `${user}/messages/${encodeURIComponent(message.id)}/attachments`;
      const attachments = await (await read(`${path}?$select=id,name,size,isInline`)).json() as GraphPage<{ id: string; name: string; size: number; isInline: boolean }>;
      const report = attachments.value.find(item => !item.isInline && /^truck[_ -]transactions.*\.csv$/i.test(item.name)
        && item.size > 0 && item.size <= 10_000_000);
      if (!report) continue;
      step = "Verify truck transactions CSV header";
      const csv = await (await read(`${path}/${encodeURIComponent(report.id)}/$value`)).text();
      const header = csv.split(/\r?\n/, 1)[0];
      const verified = ["TRANSACTION TYPE", "CTR NBR", "BOOKING"].every(column => header.includes(column));
      return NextResponse.json({ ok: verified, folder: folderName, step }, { status: verified ? 200 : 422, headers });
    }
    return NextResponse.json({ ok: false, folder: folderName, step, reason: "No matching CSV in the recent messages checked." }, { status: 404, headers });
  } catch (error) {
    const raw = error instanceof Error && /^Graph HTTP (\d{3})$/.exec(error.message);
    return NextResponse.json({ ok: false, step,
      upstreamStatus: error instanceof GraphTokenError ? error.status : raw ? Number(raw[1]) : undefined,
    }, { status: 502, headers });
  }
});
