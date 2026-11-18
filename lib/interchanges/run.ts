import { createHash } from "node:crypto";
import { connectSharePoint } from "@/lib/sharepoint/graph";
import { renderInterchangeReport } from "./report";

const mailbox = "jtyler@scmllc.net";
const folderName = "SCMI Sav Truck Transactions";
const root = "Savannah Interchanges";
const logs = "Run Logs";
type Graph = Awaited<ReturnType<typeof connectSharePoint>>;
type Page<T> = {value:T[];"@odata.nextLink"?:string};
type Item = {id:string;name:string;folder?:object;size?:number;webUrl?:string;createdDateTime?:string};
export type InterchangeRun = {
  id:string; startedAt:string; receivedAt?:string; source?:string;
  status:"complete"|"partial"|"failed"|"no-report"; error?:string;
  files:{path:string;status:"created"|"exists"|"failed";url?:string;error?:string}[];
};
const encode = (parts:string[]) => parts.map(encodeURIComponent).join("/");
const conflict = (error:unknown) => error instanceof Error && error.message === "Graph HTTP 409";

async function pages<T>(read:Graph["read"], url:string) {
  const results:T[] = [];
  for (let count=0; url && count<30; count++) {
    const page = await (await read(url)).json() as Page<T>;
    results.push(...page.value);
    url = page["@odata.nextLink"] ?? "";
  }
  if (url) throw Error("Graph folder listing did not finish.");
  return results;
}

async function newestReport(read:Graph["read"], since:Date) {
  const user = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}`;
  type Folder = {id:string;displayName:string;childFolderCount:number};
  const fields = "$select=id,displayName,childFolderCount";
  const pending = [`${user}/mailFolders?${fields}`];
  const matches:Folder[] = [];
  for (let count=0; pending.length && count<30; count++) {
    const folders = await pages<Folder>(read,pending.shift()!);
    for (const folder of folders) {
      if (folder.displayName.toLowerCase() === folderName.toLowerCase()) matches.push(folder);
      if (folder.childFolderCount) pending.push(`${user}/mailFolders/${encodeURIComponent(folder.id)}/childFolders?${fields}`);
    }
  }
  if (pending.length || matches.length !== 1) throw Error("Could not identify the Outlook report folder.");
  const folder = `${user}/mailFolders/${encodeURIComponent(matches[0].id)}`;
  const messages = await (await read(`${folder}/messages?$select=id,hasAttachments,receivedDateTime&$top=20&$orderby=receivedDateTime%20desc`)).json() as Page<{id:string;hasAttachments:boolean;receivedDateTime:string}>;
  for (const message of messages.value) {
    if (!message.hasAttachments || Date.parse(message.receivedDateTime) < since.getTime()) continue;
    const path = `${user}/messages/${encodeURIComponent(message.id)}/attachments`;
    const attachments = await pages<{id:string;name:string;size:number;isInline:boolean}>(read,`${path}?$select=id,name,size,isInline`);
    const report = attachments.find(item=>!item.isInline && /^truck[_ -]transactions.*\.csv$/i.test(item.name) && item.size > 0 && item.size <= 10_000_000);
    if (report) return {source:report.name, receivedAt:message.receivedDateTime, path:`${path}/${encodeURIComponent(report.id)}/$value`};
  }
  return null;
}

async function ensureFolder(graph:Graph, drive:string, parent:string[], name:string) {
  const child = `${drive}/root:/${encode([...parent,name])}`;
  try {
    const item = await (await graph.read(child + "?$select=id,folder")).json() as Item;
    if (!item.folder) throw Error("The SharePoint destination is not a folder.");
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Graph HTTP 404") throw error;
    try {
      await graph.request(`${drive}/root:/${encode(parent)}:/children`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name,folder:{},"@microsoft.graph.conflictBehavior":"fail"}),
      });
    } catch (reason) {
      if (!conflict(reason)) throw reason;
    }
  }
}

export async function runSavannahInterchanges() {
  const graph = await connectSharePoint();
  const drive = await graph.getDrive();
  await ensureFolder(graph,drive,[root],logs);
  const startedAt = new Date().toISOString();
  const run:InterchangeRun = {id:startedAt.replace(/[:.]/g,"-"),startedAt,status:"no-report",files:[]};
  try {
    const report = await newestReport(graph.read,new Date(Date.now()-26*3600_000));
    if (report) {
      run.source = report.source;
      run.receivedAt = report.receivedAt;
      const csv = await (await graph.read(report.path)).text();
      const digest = createHash("sha256").update(csv).digest("hex");
      const markerPath = `${drive}/root:/${encode([root,logs,`processed-${digest}.json`])}:/content`;
      try {
        const previous = await (await graph.read(markerPath)).json() as InterchangeRun;
        return previous;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "Graph HTTP 404") throw error;
      }
      const files = await renderInterchangeReport(csv);
      const folders = new Set<string>();
      for (const {path} of files) {
        const parts = path.split("/").slice(0,-1);
        const parent = [root];
        for (const part of parts) {
          const key = [...parent,part].join("/");
          if (!folders.has(key)) {
            await ensureFolder(graph,drive,parent,part);
            folders.add(key);
          }
          parent.push(part);
        }
      }
      let cursor = 0;
      await Promise.all(Array.from({length:4},async () => {
        while (cursor < files.length) {
          const {path,bytes} = files[cursor++];
          const itemPath = `${drive}/root:/${encode([root,...path.split("/")])}`;
          try {
            let item:Item;
            let status:"created"|"exists" = "created";
            try {
              item = await (await graph.request(itemPath + ":/content?@microsoft.graph.conflictBehavior=fail",{
                method:"PUT",headers:{"Content-Type":"application/pdf"},body:Buffer.from(bytes),
              })).json() as Item;
            } catch (error) {
              if (!conflict(error)) throw error;
              item = await (await graph.read(itemPath + "?$select=id,name,size,webUrl")).json() as Item;
              status = "exists";
            }
            if (!item.id || !item.size || !item.webUrl) throw Error("SharePoint did not verify the saved PDF.");
            run.files.push({path,status,url:item.webUrl});
          } catch (error) {
            run.files.push({path,status:"failed",error:error instanceof Error ? error.message : "Upload failed."});
          }
        }
      }));
      run.files.sort((a,b)=>a.path.localeCompare(b.path));
      run.status = run.files.some(file=>file.status === "failed") ? "partial" : "complete";
      if (run.status === "complete") {
        try {
          await graph.request(markerPath + "?@microsoft.graph.conflictBehavior=fail",{
            method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(run),
          });
        } catch (error) { if (!conflict(error)) throw error; }
      }
    }
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : "Interchange run failed.";
  }
  await graph.request(`${drive}/root:/${encode([root,logs,`run-${run.id}.json`])}:/content?@microsoft.graph.conflictBehavior=fail`,{
    method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(run),
  });
  return run;
}

export async function listInterchangeRuns() {
  const {read,getDrive} = await connectSharePoint();
  const drive = await getDrive();
  const folder = `${drive}/root:/${encode([root,logs])}`;
  try {
    const items = await pages<Item>(read,folder + ":/children?$select=name,id,createdDateTime&$top=200");
    return await Promise.all(items.filter(item=>/^run-[0-9TZ-]+\.json$/.test(item.name))
      .sort((a,b)=>b.name.localeCompare(a.name)).slice(0,12).map(async item=>
        (await read(`${drive}/items/${encodeURIComponent(item.id)}/content`)).json() as Promise<InterchangeRun>));
  } catch (error) {
    if (error instanceof Error && error.message === "Graph HTTP 404") return [];
    throw error;
  }
}
