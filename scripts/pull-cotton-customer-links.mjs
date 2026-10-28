// Resolve only explicit bridge targets absent from the cotton order snapshot.
import fs from 'node:fs/promises';import path from 'node:path';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2===0?[...a,[v.replace(/^--/,''),all[i+1]]]:a,[]));
const env=JSON.parse(await fs.readFile(args['env-file'],'utf8'));
let sourceKeys;
try { const manifest=JSON.parse(await fs.readFile(path.join(args['source-dir'],'manifest.json'),'utf8'));if(!manifest.complete)throw Error('Incomplete cotton extraction');sourceKeys=manifest.sources.map(x=>x.key); }
catch(error){if(args['allow-partial']!=='true')throw error;sourceKeys=(await fs.readdir(args['source-dir'])).filter(x=>x.endsWith('.json')&&!x.endsWith('.checkpoint.json')&&x!=='manifest.json').map(x=>x.slice(0,-5));}
const accounts=new Map();
for(const key of sourceKeys){const p=JSON.parse(await fs.readFile(path.join(args['source-dir'],key+'.json'),'utf8'));if(!p.complete)continue;for(const o of p.orders)accounts.set(o.customer,{code:o.customer,name:o.name,bridge:o.bridge});}
let previous=[];try{previous=JSON.parse(await fs.readFile(args.output,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const extra=previous.filter(x=>!accounts.has(x.code));for(const x of extra)accounts.set(x.code,x);
const attempted=new Set();
for(let depth=0;depth<10;depth++){
 const pending=[...new Set([...accounts.values()].map(x=>x.bridge).filter(x=>x&&!accounts.has(x)&&!attempted.has(x)))];if(!pending.length)break;
 let i=0;await Promise.all(Array.from({length:3},async()=>{while(i<pending.length){const code=pending[i++];attempted.add(code);if(!/^[A-Za-z0-9_-]{1,32}$/.test(code))continue;
 const r=await fetch(env.MCLEOD_BASE_URL.replace(/\/$/,'')+'/customers/'+encodeURIComponent(code),{headers:{Authorization:'Bearer '+env.MCLEOD_AUTH_TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(25000)});
 if(!r.ok||r.status===204)continue;
 const x=await r.json();if(String(x.id)!==code||x.company_id!=='TMS')throw Error('Bridge target identity mismatch');
 const row={code,name:x.name||code,bridge:x.bridge_id||null};accounts.set(code,row);extra.push(row);
 }}));
}
await fs.writeFile(args.output,JSON.stringify(extra),{mode:0o600});console.log(JSON.stringify({extraMetadata:extra.length,unresolved:[...new Set([...accounts.values()].map(x=>x.bridge).filter(x=>x&&!accounts.has(x)))]}));
