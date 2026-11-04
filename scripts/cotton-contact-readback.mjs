// Read-only source discovery. No credentials or unrelated contact records are logged.
import sql from 'mssql';
const configured=['MCLEOD_DB_SERVER','MCLEOD_DB_USER','MCLEOD_DB_PASSWORD','MCLEOD_DB_NAME'].every(k=>!!process.env[k]);
console.log('CONTACT_SQL_CONFIGURED '+configured);
if(configured){
 try{
 const pool=await sql.connect({server:process.env.MCLEOD_DB_SERVER,user:process.env.MCLEOD_DB_USER,password:process.env.MCLEOD_DB_PASSWORD,database:process.env.MCLEOD_DB_NAME,connectionTimeout:10000,requestTimeout:10000,options:{encrypt:false,trustServerCertificate:true}});
 const r=await pool.request().query("select TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,DATA_TYPE from INFORMATION_SCHEMA.COLUMNS where TABLE_NAME in ('contact','contacts','location') order by TABLE_NAME,ORDINAL_POSITION");
 console.log('CONTACT_SQL_SCHEMA '+JSON.stringify(r.recordset));await pool.close();
 }catch(e){console.log('CONTACT_SQL_UNAVAILABLE '+String(e.code||'connection failed'))}
}
const base=process.env.MCLEOD_BILLING_READ_BASE_URL||process.env.MCLEOD_BASE_URL;
const token=process.env.MCLEOD_BILLING_READ_AUTH_TOKEN||process.env.MCLEOD_AUTH_TOKEN;
if(base&&token){
 for(const path of ['/locations/ALBEEDNC/contacts','/contacts/search?contact.parent_row_id=ALBEEDNC&recordLength=1','/contacts?parent_row_id=ALBEEDNC&recordLength=1']){
 const r=await fetch(base.replace(/\/$/,'')+path,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
 console.log('CONTACT_PROBE '+JSON.stringify({path,status:r.status}));
 if(r.ok){const d=await r.json();const sample=Array.isArray(d)?d[0]:d;console.log('CONTACT_PROBE_SHAPE '+JSON.stringify({path,keys:sample&&typeof sample==='object'?Object.keys(sample):[],sample:sample&&sample.parent_row_id==='ALBEEDNC'?sample:undefined}))}
 else if(r.status===400){console.log('CONTACT_PROBE_ERROR '+(await r.text()).slice(0,1200))}
 }
}
