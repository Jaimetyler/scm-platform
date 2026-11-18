import Papa from "papaparse";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const types: Record<string, [string, string]> = {
  DM: ["out","OutGate - Deliver Empty"], RM: ["in","InGate - Receive Empty"],
  DI: ["out","OutGate - Deliver Import"], RE: ["in","InGate - Receive Export"],
  DE: ["in","InGate - Deliver Export"], RC: ["in","InGate - Receive Chassis"],
  DC: ["out","OutGate - Deliver Chassis"],
};

export async function renderInterchangeReport(csv: string) {
  const report = Papa.parse<Record<string,string>>(csv, {header:true,skipEmptyLines:"greedy"});
  const fields = ["TRANSACTION TYPE","CTR NBR","BOOKING","TRANSACTION NBR","ENTERED_YARD","TERMINAL"];
  if (report.errors.length || !fields.every(field => report.meta.fields?.includes(field))) {
    throw Error("Invalid Truck Transactions CSV.");
  }
  const rows = new Map<string, Record<string,string>>();
  for (const row of report.data) {
    const container = row["CTR NBR"].trim().toUpperCase();
    if (!container) continue;
    const type = row["TRANSACTION TYPE"].trim().toUpperCase();
    const booking = row.BOOKING.trim().replace(/\.0+$/, "");
    if (!Object.hasOwn(types,type) || !/^[A-Z]{4}\d{7}$/.test(container) || booking && !/^[A-Z0-9_-]+$/i.test(booking)) {
      throw Error("Report has an invalid container, booking, or transaction type.");
    }
    const path = `${booking ? "Exports/" + booking : "Imports"}/${container}_${types[type][0]}.pdf`;
    const normalized = {...row,"CTR NBR":container,BOOKING:booking,"TRANSACTION TYPE":type};
    if (rows.has(path) && JSON.stringify(rows.get(path)) !== JSON.stringify(normalized)) {
      throw Error(`Report contains conflicting transactions for ${path}.`);
    }
    rows.set(path, normalized);
  }
  if (!rows.size) throw Error("The report contains no interchange records.");
  const logo = await readFile(join(process.cwd(),"public","scm-logo.png"));
  const files: {path:string; bytes:Uint8Array}[] = [];
  for (const [path,row] of rows) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612,792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const image = await doc.embedPng(logo);
    page.drawImage(image,{x:36,y:730,...image.scaleToFit(140,45)});
    const terminal = row.TERMINAL === "GCT" ? "Georgia Ports Authority - Savannah" : row.TERMINAL === "OT" ? "Ocean Terminal - GPA Savannah" : row.TERMINAL;
    const draw = (value: string, x: number, y: number, size = 11, title = false) => {
      const face = title ? bold : font;
      const safe = [...value].filter(character => {
        try { face.encodeText(character); return true; } catch { return false; }
      }).join("");
      let line = safe.replace(/[\r\n\t]/g," ");
      while (line && face.widthOfTextAtSize(line,size) > 570 - x) line = line.slice(0,-1);
      page.drawText(line,{x,y,size,font:face});
    };
    draw(terminal,36,695,16,true);
    draw(`Date: ${row.ENTERED_YARD}`,36,675);
    const entries = [
      ["SSL",row.LINE],["Booking Number",row.BOOKING],["Container Number",row["CTR NBR"]],
      ["Chassis Number",[row["CHS NBR"],row.CHS_IS_OWNERS?.toLowerCase() === "yes" ? "Private Chassis" :
        row.CHS_IS_OWNERS?.toLowerCase() === "no" ? "Pool Chassis" : ""].filter(Boolean).join(" - ")],
      ["Seal",row.SEAL_NBR1],["Cargo Weight (LBS)",row.CARGO_WT],
      ["Trucking Company",row["TRUCKING COMPANY ID"] === "SCQW" ? "SCQW - SCM Intermodal" : row["TRUCKING COMPANY ID"]],
      ["Truck ID",row.LICENSE_NBR],["EIR",row["TRANSACTION NBR"]],["Pin",row.PIN],
      ["Transaction Type",types[row["TRANSACTION TYPE"]][1]],["Status",row.STATUS],["Size",row.SZTPHT],
    ];
    entries.forEach(([label,value],index) => draw(`${label}: ${value ?? ""}`,36,636-index*23));
    files.push({path,bytes:await doc.save()});
  }
  return files;
}
