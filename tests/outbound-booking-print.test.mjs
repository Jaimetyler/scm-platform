import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync("components/warehouse/BookingPrintSheet.tsx","utf8"), {
  compilerOptions:{ jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function("require","exports",code)(name => name === "@/lib/warehouse/outbound/details"
  ? {formatBookingDate:()=>"—"} : require(name),exports);

const booking = {terminal:"DAL", booking_number:"2342071250", scm_file_number:"41458",
  customer:"Bunge", site_name:"Dallas - 2119", requested_bales:540, planned_containers:6};
const lines = Array.from({length:6},(_,i)=>({id:`mark-${i}`,mark:`MARK${i}`,requested_bales:90,inventory_locations:[]}));
const containers = Array.from({length:6},(_,i)=>({id:`slot-${i}`,sequence_no:i+1,booking_line_id:null,scm_order_number:`083084${i}`}));
const render = (data = {}) => renderToStaticMarkup(React.createElement(exports.default,{booking,lines,containers,...data}));

test("Dallas prints six load slots with unassigned marks and labels its legacy Book ID", () => {
  const html = render();
  const body = html.match(/<tbody>(.*?)<\/tbody>/s)[1];
  assert.equal((body.match(/<tr>/g) ?? []).length,6);
  assert.equal((body.match(/>Unassigned</g) ?? []).length,6);
  assert.match(html,/<b>Book ID<\/b> 41458/);
  assert.match(html,/<b>SCM File #<\/b> —/);
  const explicit = render({booking:{...booking, book_id:"41500"}});
  assert.match(explicit,/<b>Book ID<\/b> 41500/);
  assert.match(explicit,/<b>SCM File #<\/b> 41458/);
});

test("print history identifies both directions and removed marks even without a transfer slot", () => {
  const date = "2026-11-17T15:00:00Z";
  const html = render({history:[
    {id:"in",mark:"INMARK",action:"Moved in",booking:"SOURCE",bales:25,date},
    {id:"out",mark:"OUTMARK",action:"Moved out",booking:"TARGET",bales:50,date},
    {id:"cancel",mark:"OLDMARK",action:"Removed",note:"Customer cancelled",date},
  ]});
  assert.match(html,/INMARK · Moved in 25 bales from booking SOURCE/);
  assert.match(html,/OUTMARK · Moved out 50 bales to booking TARGET/);
  assert.match(html,/OLDMARK · Removed · Customer cancelled/);
});
