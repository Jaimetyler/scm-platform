import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {parseBookingRequest,prepareBookingImport} from '../lib/warehouse/outbound/booking-import.ts';
import {previewDallasBungeDrays} from '../lib/dray/dallas-booking.ts';
function workbook(rows, type='xlsx') {
 const book=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Request');
 return XLSX.write(book,{type:'buffer',bookType:type});
}
const olam=[['Dray Dispatch'],['Olam Agri Americas Inc'],['Booking :',2343518850,'Booking Ref :',47439],
 ['Sale No :','26/S/10127'],['Containers :',"1 x 40' STD or HC"],['Loaded Return :','Dallas Ramp BNSF Haslet'],
 ['1st Avail / ERD :',46335],['Doc Cut :',46344,'Ramp Cut :',46339],['Vessel/Voyage :','TEST VESSEL','S/S Line :','MAERSK'],
 ['TOTAL BALE COUNT: 88'],[' Bales','Mark','SO','Whse','Warehouse','Ready Date'],
 [' 88','WTMC',3586816,875260,'Supply Chain Management- Desoto',46335],[' Whse Code','Warehouse Name']];
const edfHead=['ocean_carrier_name','ocean_vessel_name','stuffing_reference','carrier_booking_number','exporter_ref_po_number','container_num_stuffed','stuffing_place','earliest_return_date','terminal_cutoff','document_cutoff','full_return_place','empty_pickup_place'];
const edfRow=['EVERGREEN','EVER MAGIC','W0282','401610452490','C00003.016','EGSU1373670','USDAL','05 Nov 10:00','01 Nov 19:00','06 Nov 11:00','3701 SOUTH INTERSTATE 45','3701 SOUTH INTERSTATE 45'];
const edf=[edfHead,edfRow,[...edfRow.slice(0,2),'W0381',...edfRow.slice(3,5),'EMCU0051047',...edfRow.slice(6)]];
const confirmed={dateYear:'2026',bales:{2:'88',3:'90'},customerConfirmed:true,warehouseConfirmed:true};

test('Olam recognizes cell identity and maps original xlsb/xlsx, bales, SO and distinct Dallas cutoffs',()=>{
 for(const type of ['xlsb','xlsx']) {
  const booking=prepareBookingImport(parseBookingRequest(workbook(olam,type)),'DAL','SCMDDETX');
  assert.equal(booking.customer,'Olam Agri Americas Inc'); assert.equal(booking.bookingNumber,'2343518850');
  assert.equal(booking.returnLocation,'Dallas Ramp BNSF Haslet'); assert.equal(booking.steamshipLine,'MAERSK'); assert.equal(booking.totalBales,88); assert.equal(booking.erd,'2026-11-09');
  assert.equal(booking.docCutoff,'2026-11-18'); assert.equal(booking.cutoff,'2026-11-13');
  assert.equal(booking.lines[0].loadSource,'warehouse'); assert.equal(booking.lines[0].shippingOrder,'3586816');
  assert.equal(previewDallasBungeDrays(workbook(olam,type)).deliveryLocation,'BNSFHATX');
 }
});
test('ED&F keeps missing data unresolved and preserves each mark/container pair',()=>{
 const b=parseBookingRequest(workbook(edf));
 assert.equal(b.returnLocation,'3701 SOUTH INTERSTATE 45'); assert.equal(b.steamshipLine,'EVERGREEN'); assert.equal(b.sourceFormat,'edf'); assert.equal(b.customerNeedsConfirmation,true); assert.equal(b.needsDateYear,true);
 assert.equal(b.erd,null); assert.equal(b.totalBales,0); assert.deepEqual(b.lines.map(l=>l.containerNumber),['EGSU1373670','EMCU0051047']);
 assert.throws(()=>prepareBookingImport(b,'DAL','SCMDDETX',{},true),/Confirm ED&F/);
});
test('ED&F confirmation and explicit year/counts prepare a complete Dallas draft without changing container assignment',()=>{
 const b=prepareBookingImport(parseBookingRequest(workbook(edf),confirmed),'DAL','SCMDDATX',confirmed,true);
 assert.equal(b.totalBales,178); assert.equal(b.erd,'2026-11-05'); assert.equal(b.docCutoff,'2026-11-06T11:00');
 assert.equal(b.cutoff,'2026-11-01T19:00'); // source is odd; never silently reorder its dates
 assert(b.lines.every(l=>l.loadSource==='warehouse'&&l.warehouseCode==='SCMDDATX'));
 for(const key of ['customerConfirmed','warehouseConfirmed'])assert.throws(()=>prepareBookingImport(b,'DAL','SCMDDETX',{...confirmed,[key]:false},true),/Confirm/);
 assert.throws(()=>prepareBookingImport(b,'SAV','984',confirmed,true),/Dallas only/);
});
test('missing/invalid bale edits and impossible dates cannot save as invented data',()=>{
 for(const bad of ['0','-1','1.5','abc'])assert.throws(()=>parseBookingRequest(workbook(edf),{...confirmed,bales:{2:bad}}),/positive bale/);
 const missing=parseBookingRequest(workbook(edf),{...confirmed,bales:{2:88}});
 assert.throws(()=>prepareBookingImport(missing,'DAL','SCMDDETX',confirmed,true),/every load/);
 const badDates=[edfHead,[...edfRow.slice(0,7),'31 Feb 10:00',...edfRow.slice(8)]];
 assert.throws(()=>parseBookingRequest(workbook(badDates),confirmed),/Invalid/);
});
test('mixed bookings, duplicate equipment and conflicting metadata fail rather than merge unrelated loads',()=>{
 const mixed=edf.map(r=>[...r]);mixed[2][3]='OTHERBOOK'; assert.throws(()=>parseBookingRequest(workbook(mixed)),/multiple carrier_booking_number/);
 const duplicate=edf.map(r=>[...r]);duplicate[2][5]='EGSU1373670';assert.throws(()=>parseBookingRequest(workbook(duplicate)),/repeated container/);
 const mismatch=olam.map(r=>[...r]);mismatch[9][0]='TOTAL BALE COUNT: 90';assert.equal(parseBookingRequest(workbook(mismatch)).warnings.length,1);
});
test('Bunge remains recognized and unsupported identities cannot inherit a Bunge customer',()=>{
 const rows=[['Booking Request'],['Bunge USA Agriculture LLC'],['Booking #:', 'TEST-123'],['Mark','S.O.','','Warehouse','Bales'],['ABC','123','875260','SCM Desoto',90],['Containers:',1,'SSL:', 'MSC']];
 assert.equal(parseBookingRequest(workbook(rows)).sourceFormat,'bunge');
 assert.equal(parseBookingRequest(workbook(rows)).steamshipLine,'MSC');
 rows[1][0]='Unknown customer'; assert.throws(()=>parseBookingRequest(workbook(rows)),/not recognized/);
});
