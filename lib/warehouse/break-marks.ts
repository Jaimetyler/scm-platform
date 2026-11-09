export type BreakMarkRow = { mark: string; shippingOrder: string; bales: number };
export type BreakQuantity = "bales" | "pasadena" | "mckinney";
const key = (v: string) => v.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
function cells(line: string) {
  if (line.includes("\t")) return line.split("\t");
  if (line.trim().startsWith("|")) return line.trim().replace(/^\||\|$/g, "").split("|");
  const result: string[] = []; let value = "", quoted = false;
  for (let i=0; i<line.length; i++) {
    const c=line[i];
    if(c==='"' && line[i+1]==='"' && quoted) { value+='"'; i++; }
    else if(c==='"') quoted=!quoted;
    else if(c===',' && !quoted) {result.push(value);value="";}
    else value+=c;
  }
  if(quoted) throw new Error("A pasted row has an unclosed quote.");
  result.push(value);return result;
}
export function parseBreakMarks(text: string, quantity?: string) {
  if(typeof text!=="string" || text.length>150000) throw new Error("Paste up to 250 break marks (150 KB maximum).");
  const lines=text.replace(/\u00a0|&#x20;/gi," ").split(/\r?\n/).filter(l=>l.trim());
  let header: string[] | null=null;const rows: BreakMarkRow[]=[];let skippedZero=0;
  const seen=new Set<string>();
  for(const [index,line] of lines.entries()) {
    let values=cells(line).map(v=>v.trim());
    // Some customer tables include an empty outer column; no meaningful field
    // is blank before the mark. Remove only those leading/trailing cells.
    while(values[0]==="") values.shift();while(values.at(-1)==="") values.pop();
    if(!values.length || values.every(v=>/^[-: ]+$/.test(v)))continue;
    if(values.some(v=>["BREAKMARK","BREAKMARKS","MARK"].includes(key(v)))) {header=values.map(key);continue;}
    if(header && header.some(v=>["PASADENA","MCKINNEY"].includes(v)) && !quantity)
      throw new Error("This sheet has warehouse quantities. Choose Bale Count, Pasadena or McKinney before previewing.");
    const markIndex=header?header.findIndex(v=>["BREAKMARK","BREAKMARKS","MARK"].includes(v)):0;
    const orderIndex=header?header.findIndex(v=>["SO","SONUMBER","SHIPPINGORDER","SHIPPINGORDERNUMBER"].includes(v)):1;
    const quantityKey=quantity==="pasadena"?"PASADENA":quantity==="mckinney"?"MCKINNEY":"BALECOUNT";
    const countIndex=header?header.findIndex(v=>v===quantityKey || quantityKey==="BALECOUNT" && ["BALES","BALECOUNT","QUANTITY"].includes(v)):2;
    if(markIndex<0 || countIndex<0)throw new Error(`Missing ${quantityKey==="BALECOUNT"?"bale count":quantityKey} column. Use Mark, S.O. #, Bale Count headers.`);
    const mark=(values[markIndex]??"").toUpperCase(),shippingOrder=orderIndex<0?"":values[orderIndex]??"";
    const raw=values[countIndex]??"";
    if(!/^\d[\d,]*$/.test(raw))throw new Error(`Row ${index+1}: enter a whole bale count.`);
    const bales=Number(raw.replaceAll(",",""));
    if(!/^[A-Z0-9][A-Z0-9 ._/-]{0,79}$/.test(mark)||shippingOrder.length>200||!Number.isSafeInteger(bales)||bales<0||bales>1000000)
      throw new Error(`Row ${index+1}: check the mark, shipping order and bale count (maximum 1,000,000).`);
    if(!bales){skippedZero++;continue;}
    if(seen.has(mark))throw new Error(`Mark ${mark} appears more than once. Combine or correct it before importing.`);
    seen.add(mark);rows.push({mark,shippingOrder,bales});
    if(rows.length>250)throw new Error("Import at most 250 break marks at a time.");
  }
  if(!rows.length)throw new Error("No positive-quantity break marks found for the selected column.");
  return {rows,skippedZero,totalBales:rows.reduce((sum,r)=>sum+r.bales,0)};
}
