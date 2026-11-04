// Read McLeod contacts by exact location ID; optionally fill empty outreach contacts with CAS/audit.
// No writes to McLeod; no credential values or unrelated records are logged.
import {createClient} from '@supabase/supabase-js';
import {locationPhones} from '../lib/cotton-locations/contact-match.mjs';
const apply=process.argv.includes('--apply');
const db=createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const base=process.env.MCLEOD_BILLING_READ_BASE_URL||process.env.MCLEOD_BASE_URL,token=process.env.MCLEOD_BILLING_READ_AUTH_TOKEN||process.env.MCLEOD_AUTH_TOKEN;
if(!base||!token)throw Error('McLeod read connection unavailable');
const [{data:locations,error:le},{data:queue,error:qe}]=await Promise.all([
 db.from('cotton_location_master').select('id,mcleod_code').limit(3000),db.from('cotton_tariff_outreach').select('*').limit(3000)]);
if(le||qe)throw Error('Location queue unavailable');
const stats={mode:apply?'apply':'preview',examined:0,matched:0,filled:0,multiple:0,missing:0,preserved:0,failed:[]};let index=0;
await Promise.all(Array.from({length:4},async()=>{while(index<locations.length){const l=locations[index++],row=queue.find(q=>q.location_id===l.id);if(!row)continue;
if(row.contact_phone.trim()||row.status==='reviewed'){stats.preserved++;continue}
try{
 if(!/^[A-Za-z0-9_-]{1,8}$/.test(l.mcleod_code))throw Error('Invalid location code');
 const r=await fetch(base.replace(/\/$/,'')+'/contacts/L/'+encodeURIComponent(l.mcleod_code),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('HTTP '+r.status);
 const contacts=r.status===204?[]:await r.json();stats.examined++;
 const match=locationPhones(contacts,l.mcleod_code);
 if(!match.candidates.length){stats.missing++;continue}
 const lines=[...new Set(match.candidates.map(c=>`${c.name||'Location contact'}: ${c.phone} (${c.field}; contact ${c.id})`))];
 const source='McLeod contact table, location '+l.mcleod_code+'; historical contact details, confirm with facility.\n'+lines.join('\n');
 if(row.notes.includes(source)){stats.preserved++;continue}
 const notes=[row.notes,source].filter(Boolean).join('\n\n');if(notes.length>5000)throw Error('Notes require manual review');
 const changes={owner:row.owner,priority:row.priority,status:row.status,contact_name:row.contact_name|| (match.selected?.name||''),contact_email:row.contact_email,contact_phone:match.selected?.phone||'',last_contact:row.last_contact,next_follow_up:row.next_follow_up,effective_date:row.effective_date,notes};
 if(match.selected)stats.matched++;else stats.multiple++;
 if(apply){const {error}=await db.rpc('save_cotton_tariff_outreach',{p_location:l.id,p_version:row.version,p_changes:changes,p_actor:'Codex; McLeod contact enrichment authorized by Jaime Tyler',p_admin:true});if(error)throw Error('Queue changed or save failed');if(match.selected)stats.filled++;}
}catch(e){stats.failed.push({code:l.mcleod_code,error:e.message})}
}}));
console.log('CONTACT_ENRICHMENT '+JSON.stringify(stats));
