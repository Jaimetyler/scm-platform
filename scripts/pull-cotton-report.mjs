// Read-only McLeod report extraction. Private raw/normalized data stays outside git.
import fs from 'node:fs/promises';
import path from 'node:path';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2===0?[...a,[v.replace(/^--/,''),all[i+1]]]:a,[]));
if(!args['env-file']||!args.output)throw Error('Required: --env-file <private file> --output <private directory>');
const env=JSON.parse(await fs.readFile(args['env-file'],'utf8'));
const base=env.MCLEOD_BASE_URL?.replace(/\/$/,''),token=env.MCLEOD_AUTH_TOKEN;
if(!base||!token)throw Error('McLeod read connection missing');
await fs.mkdir(args.output,{recursive:true,mode:0o700});
const start='20250101',end='20261020',pageSize=100;
const sources=[...['MAIN','DAVIS','DDRAY','LOCAL','HLOCAL','HLOCA'].map(code=>({key:code+'-cotton',code,commodity:'COTTON'})),...['LOCAL','HLOCAL','HLOCA','DLOCA'].map(code=>({key:code+'-ecotton',code,type:'ECOTTON'}))];
function normalize(o){
 const movements=o.movements??o.movement??[];
 const m=Array.isArray(movements)?movements.find(x=>String(x.id)===String(o.curr_movement_id)):null;
 const stops=(o.stops??[]).map(s=>({id:s.id,type:s.stop_type,location:s.location_id}));
 return {company:o.company_id,id:String(o.id),customer:o.customer_id,name:o.customer?.name||o.customer_id,bridge:o.customer?.bridge_id||null,
  code:o.revenue_code_id,type:o.order_type_id||'',commodity:o.commodity_id||'',status:o.status,bill:o.bill_date||null,
  revenue:o.total_charge,freight:o.freight_charge,chargeTotal:o.otherchargetotal,
  movementId:o.curr_movement_id,matchedMovementId:m?.id??null,pay:m?.override_pay_amt??null,payee:m?.override_payee_id??null,
  pickup:stops.find(s=>String(s.id)===String(o.shipper_stop_id))?.location??null,
  delivery:stops.find(s=>String(s.id)===String(o.consignee_stop_id))?.location??null};
}
async function read(url){
 for(let attempt=0;attempt<2;attempt++){
  const r=await fetch(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(45000)});
  if(!r.ok){if(r.status>=500&&attempt===0)continue;throw Error('McLeod read HTTP '+r.status);}
  const value=await r.json();if(value===null)return [];if(!Array.isArray(value))throw Error('Unexpected order search shape');return value;
 }
}
async function extract(source){
 const final=path.join(args.output,source.key+'.json');
 try{const prior=JSON.parse(await fs.readFile(final,'utf8'));if(prior.complete){console.log(JSON.stringify({source:source.key,cached:true,count:prior.orders.length}));return prior;}}catch(e){if(e.code!=='ENOENT')throw e;}
 const orders=[],seen=new Set();let previousDate='99999999',done=false;
 for(let offset=0;offset<100000;offset+=pageSize){
  const q=new URLSearchParams({'orders.revenue_code_id':source.code,orderBy:'orders.bill_date DESC,orders.id DESC',recordLength:String(pageSize),recordOffset:String(offset)});
  if(source.commodity)q.set('orders.commodity_id',source.commodity);if(source.type)q.set('orders.order_type_id',source.type);
  const rows=await read(base+'/orders/search?'+q);if(rows.length>pageSize)throw Error('Pagination length ignored');
  let pastStart=false,newIds=0;
  for(const raw of rows){
   if(String(raw.company_id)!=='TMS'||String(raw.revenue_code_id)!==source.code||(source.commodity&&raw.commodity_id!==source.commodity)||(source.type&&raw.order_type_id!==source.type))throw Error('Source filter ignored');
   const id=String(raw.id||'');if(!id)throw Error('Missing source order ID');if(seen.has(id))throw Error('Order search pagination repeated ID');seen.add(id);newIds++;
   const date=String(raw.bill_date||'').slice(0,8);
   if(!date){pastStart=true;continue;}
   if(!/^\d{8}$/.test(date)||date>previousDate)throw Error('Bill-date ordering not established');previousDate=date;
   if(date<start){pastStart=true;continue;}
   if(date<=end)orders.push(normalize(raw));
  }
  await fs.writeFile(path.join(args.output,source.key+'.checkpoint.json'),JSON.stringify({source,offset,orders}),{mode:0o600});
  if(rows.length<pageSize||pastStart){done=true;break;}
  if(!newIds)throw Error('Order search did not advance');
 }
 if(!done)throw Error('Source pagination bound reached');
 const out={source,complete:true,start,end,extractedAt:new Date().toISOString(),orders};
 await fs.writeFile(final,JSON.stringify(out),{mode:0o600});console.log(JSON.stringify({source:source.key,count:orders.length,complete:true}));return out;
}
let cursor=0;const results=[];
await Promise.all(Array.from({length:3},async()=>{while(cursor<sources.length){const source=sources[cursor++];results.push(await extract(source));}}));
await fs.writeFile(path.join(args.output,'manifest.json'),JSON.stringify({complete:true,sources:results.map(x=>({key:x.source.key,count:x.orders.length,start:x.start,end:x.end}))}),{mode:0o600});
console.log('All cotton source partitions completed.');
