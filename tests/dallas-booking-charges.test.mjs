import test from "node:test";
import assert from "node:assert/strict";
import { bookingOrderMarks, readBookingMarkCharges } from "../lib/dray/booking-charges.ts";
import { getCheckinSite } from "../lib/inbound/checkin/sites.ts";

test("reads only DDRAY Bunge orders at the Dallas booking yard and preserves every returned charge", async () => {
  const source = { customer_id: "BUNGOMNE", blnum: "A0250 90 BALES", consignee_refno: "A0250",
    status: "A", rate: "125.00", rate_units: "1", total_charge: "140",
    other_charges: [{ charge_id: "040", descr: "Chassis", units: "1", rate: "15", amount: "15" }],
    stops: [{ id: "PU1", stop_type: "PU", location_id: "SCMDDETX" }] };
  const orders = [
    { ...source, id: "101", revenue_code_id: "DDRAY" },
    { ...source, id: "102", revenue_code_id: "DDRAY", other_charges: undefined },
    { ...source, id: "103", revenue_code_id: "DDRAY", stops: [{ id: "PU2", stop_type: "PU", location_id: "SCMDDATX" }] },
    { ...source, id: "104", revenue_code_id: "DDRAY", customer_id: "OTHER" },
    { ...source, id: "105", revenue_code_id: "DAVIS" },
  ];
  const reads = [];
  const result = await readBookingMarkCharges(async path => {
    reads.push(path);
    if (path.startsWith("/orders/search?")) {
      assert.equal(new URL(path, "https://example.invalid").searchParams.get("orders.revenue_code_id"), "DDRAY");
      return orders.slice(Number(new URL(path, "https://example.invalid").searchParams.get("recordOffset")));
    }
    if (path === "/orders/104") return { ...orders[3], customer_id: "BUNGOMNE", revenue_code_id: "DAVIS" };
    return orders.find(order => path.endsWith("/" + order.id));
  }, getCheckinSite("DAL", "SCMDDETX"), "A0250", new AbortController().signal);
  assert.deepEqual(result.map(order => order.id), ["101", "102"]);
  assert.deepEqual(result[0].charges, [{ code: "040", description: "Chassis", units: 1, rate: 15, amount: 15 }]);
  assert.equal(result[0].total, 140);
  assert.equal(result[1].charges, null);
  assert.ok(!reads.includes("/orders/105"));
  assert.equal(reads.filter(path => path === "/orders/101").length, 1);
});

import { bookingChargeCustomer } from '../lib/dray/booking-customers.ts';
test('supported customer mappings expose the lookup without treating other names as Bunge', () => {
 assert.equal(bookingChargeCustomer('Olam Agri Americas Inc').code,'OLAMRITX');
 assert.equal(bookingChargeCustomer('ED&F Man Cotton').code,'EDFMECTX');
 assert.equal(bookingChargeCustomer('Bunge USA Agriculture LLC').code,'BUNGOMNE');
 assert.equal(bookingChargeCustomer('Unknown cotton customer'),null);
});
test('Olam and ED&F exact customer IDs are verified after hydration; other customer marks never leak into results',async()=>{
 for(const name of ['Olam Agri Americas Inc','ED&F Man Cotton']){
  const customer=bookingChargeCustomer(name);
  const orders=customer.ids.map((customer_id,i)=>({id:String(201+i),customer_id,blnum:'W0282 88 BALES',consignee_refno:'W0282',status:'A',revenue_code_id:'DDRAY',rate:100,rate_units:1,total_charge:145,other_charges:[{charge_id:'040',descr:'Chassis',amount:45}],stops:[{id:'PU1',stop_type:'PU',location_id:'SCMDDETX'}]}));
  orders.push({...orders[0],id:'299',customer_id:'BUNGOMNE'});
  const result=await readBookingMarkCharges(async path=>path.startsWith('/orders/search?')?orders:orders.find(o=>path.endsWith('/'+o.id)),getCheckinSite('DAL','SCMDDETX'),'W0282',new AbortController().signal,customer.ids);
  assert.deepEqual(result.map(o=>o.id),['201','202']);
 }
});

test('booking matches can use a standalone mark within an Olam reference', () => {
 assert.deepEqual(bookingOrderMarks({blnum:'SO 47439 / WTMC',consignee_refno:'2343518850'},['WTMC']),['WTMC']);
 assert.deepEqual(bookingOrderMarks({blnum:'WTMCX'},['WTMC']),[]);
 assert.deepEqual(bookingOrderMarks({blnum:'X4803 X4804'},['X4803','X4804']),[]);
});

test('mark fallback rejects a DDRAY order on a different saved booking', async () => {
 const order={id:'204',customer_id:'OLAMRITX',blnum:'WTMC',consignee_refno:'WTMC',booking_no_sucm:'2342891820',revenue_code_id:'DDRAY',stops:[{location_id:'SCMDDETX',stop_type:'PU'}]};
 const read=async path=>path.startsWith('/orders/search?')?[order]:order;
 const site=getCheckinSite('DAL','SCMDDETX');
 assert.deepEqual(await readBookingMarkCharges(read,site,'WTMC',new AbortController().signal,['OLAMRITX'],'2343518850'),[]);
});
