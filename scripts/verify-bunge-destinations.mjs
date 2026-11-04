// Read-only verification of history-derived SCM delivery IDs. Never logs credentials.
import {SCM_DELIVERY_LOCATIONS} from '../lib/bunge/destinations.ts';
const base=process.env.MCLEOD_BILLING_READ_BASE_URL||process.env.MCLEOD_BASE_URL,token=process.env.MCLEOD_BILLING_READ_AUTH_TOKEN||process.env.MCLEOD_AUTH_TOKEN;
const results=await Promise.all(SCM_DELIVERY_LOCATIONS.map(async({code})=>{
 try{
 const r=await fetch(base.replace(/\/$/,'')+'/locations/'+code,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
 if(!r.ok)return {code,status:r.status};const x=await r.json();
 if(x.id!==code||x.company_id!=='TMS')return {code,status:'identity mismatch'};
 return {code,status:!['N',false].includes(x.is_active)?'available':'inactive',name:x.name,address:x.address1,city:x.city_name,state:x.state};
 }catch{return {code,status:'lookup unavailable'}}
}));
console.log('SCM_DELIVERY_VERIFICATION '+JSON.stringify(results));
if(!results.some(x=>x.code==='SAVAGAG2'&&x.status==='available'))throw Error('Bunge default could not be verified');
