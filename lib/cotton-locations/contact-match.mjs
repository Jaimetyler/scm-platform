// Contacts must be attached to the exact McLeod location; never match on name alone.
export function locationPhones(records,code){
 if(!Array.isArray(records)||records.length>=100)throw Error('Incomplete contact result');
 const valid=records.filter(r=>r.__type==='contact'&&r.company_id==='TMS'&&r.parent_row_type==='L'&&String(r.parent_row_id).trim()===code&&![false,'N','n','false','0'].includes(r.is_active));
 const candidates=[];
 for(const r of valid){for(const field of ['phone','mobile_phone']){
 const raw=String(r[field]||'').trim();
 const parts=raw.split(/\s*(?:ext\.?|x|#)\s*/i),digits=parts[0].replace(/\D/g,'');
 if(!/^\d{10}$/.test(digits)&&!/^1\d{10}$/.test(digits))continue;
 const normalized=(digits.length===11?digits.slice(1):digits)+(parts[1]?'x'+parts[1].replace(/\D/g,''):'');
 candidates.push({phone:raw,normalized,name:String(r.contact_name||r.name||'').trim(),id:String(r.id||''),field});
 }}
 // Prefer office numbers. Retain mobile only when no office phone exists.
 const office=candidates.filter(c=>c.field==='phone');const pool=office.length?office:candidates;
 const numbers=[...new Set(pool.map(c=>c.normalized))];
 return {candidates:pool,selected:numbers.length===1?pool[0]:null};
}
