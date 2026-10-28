'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {cottonServices,cottonTransportGP,cottonContribution,type CottonMetrics} from '@/lib/reporting/cotton';
import styles from '../warehouse-intelligence/warehouse-intelligence.module.css';
type Month={month:string;[key:string]:string|number};
type Account={warehouse:string;code:string;name:string;accounts:string[];codes:string[];relationshipReview:boolean;metrics:CottonMetrics;months:Month[]};
type Customer={code:string;name:string;locations:Account[];metrics:CottonMetrics;months:Month[];accounts:string[]};
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
const compact=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(n);
const num=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const val=(m:CottonMetrics,k:string)=>m[k]||0;
function sum(items:Account[]) {
 const metrics:CottonMetrics={},months=new Map<string,Month>();
 for(const c of items){
  for(const [k,v] of Object.entries(c.metrics))metrics[k]=(metrics[k]||0)+v;
  for(const m of c.months){const row=months.get(m.month)||{month:m.month};
   for(const [k,v] of Object.entries(m))if(k!=='month'&&typeof v==='number')row[k]=Number(row[k]||0)+v;
   months.set(m.month,row);
  }
 }
 return {metrics,months:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month))};
}
function detail(metrics:CottonMetrics,key:string){
 const count=val(metrics,'warehouseOrders');
 return count===0?'—':val(metrics,'warehouseDetailedOrders')===count?money(val(metrics,key)):'Pending charge detail';
}
function Services({metrics}:{metrics:CottonMetrics}){
 return <div className={styles.tableScroll}><table><thead><tr><th>Service</th><th>Orders / invoices</th><th>Billed revenue</th><th>Verified carrier pay</th><th>Known-pay GP*</th></tr></thead>
 <tbody>{cottonServices(metrics).map(r=><tr key={r.kind}><td>{r.label}</td><td>{num(r.orders)}</td><td>{money(r.revenue)}</td><td>{r.pay===null?'—':money(r.pay)}</td><td>{r.gp===null?'—':`${money(r.gp)}${r.payMissing?' *':''}`}</td></tr>)}</tbody></table></div>;
}
export default function CottonIntelligence(){
 const [data,setData]=useState<Account[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [terminal,setTerminal]=useState('All'),[query,setQuery]=useState(''),[sort,setSort]=useState('contribution'),[selectedCode,setSelectedCode]=useState<string|null>(null);
 useEffect(()=>{const controller=new AbortController();
  fetch('/api/reporting/cotton-intelligence',{cache:'no-store',signal:controller.signal})
   .then(async r=>{if(!r.ok)throw Error(r.status===403?'Administrator access is required.':'Cotton report could not be loaded.');return r.json();})
   .then(r=>{if(!controller.signal.aborted)setData(r.customers);})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message);})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[]);
 const locationRows=useMemo(()=>data.filter(c=>terminal==='All'||c.warehouse===terminal),[data,terminal]);
 const customers=useMemo(()=>{
  const groups=new Map<string,Account[]>();
  for(const c of locationRows)groups.set(c.code,[...(groups.get(c.code)||[]),c]);
  return [...groups.entries()].map(([code,locations]):Customer=>({code,name:locations[0].name,locations,accounts:[...new Set(locations.flatMap(c=>c.accounts))],...sum(locations)}));
 },[locationRows]);
 const filtered=useMemo(()=>customers.filter(c=>`${c.name} ${c.code} ${c.accounts.join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='revenue'?cottonServices(b.metrics).reduce((n,r)=>n+r.revenue,0)-cottonServices(a.metrics).reduce((n,r)=>n+r.revenue,0):cottonContribution(b.metrics)-cottonContribution(a.metrics)),[customers,query,sort]);
 const selected=selectedCode?customers.find(c=>c.code===selectedCode):null;
 const total=sum(filtered.flatMap(c=>c.locations)).metrics;
 const metrics=selected?.metrics||total;
 const missing=val(metrics,'otrPayMissing')+val(metrics,'drayPayMissing');
 const linksMissing=(selected?selected.locations:filtered.flatMap(c=>c.locations)).filter(c=>c.relationshipReview).length;
 return <main className={styles.shell}>
  <header className={styles.head}><div><p className={styles.eyebrow}>SCM / REPORTING & ANALYTICS</p><h1>Cotton Intelligence</h1><p className={styles.sub}>Cotton transport and warehouse billing · Jan 2025 – Oct 20, 2026 · Bill-date basis</p></div><div className={styles.tag}>Historical snapshot · Not live</div></header>
  <p><Link style={{color:'#67e8f9'}} href="/reporting/warehouse-intelligence">3PL & Warehouse Intelligence</Link> · <Link style={{color:'#67e8f9'}} href="/">Platform home</Link></p>
  {loading&&<p role="status">Loading protected cotton data…</p>}
  {error&&<p role="alert">{error}</p>}
  <div className={styles.toolbar}>
   <div className={styles.segment} aria-label="Cotton terminal filter">{['All','Savannah','Houston','Dallas','Unassigned'].map(t=><button key={t} type="button" aria-pressed={terminal===t} className={terminal===t?styles.active:''} onClick={()=>setTerminal(t)}>{t==='All'?'All terminals':t}</button>)}</div>
   <input aria-label="Search cotton customers" placeholder="Search customer, account or bridge…" value={query} onChange={e=>{setQuery(e.target.value);setSelectedCode(null);}}/>
   <select aria-label="Sort cotton customers" value={sort} onChange={e=>setSort(e.target.value)}><option value="contribution">Sort: Contribution proxy</option><option value="revenue">Sort: Billed revenue</option><option value="name">Sort: Customer name</option></select>
  </div>
  {!loading&&!error&&<>
   <p className={styles.hint}>OTR: MAIN / DAVIS with commodity COTTON. Drays: cotton LOCAL / HLOCAL / HLOCA and DDRAY. ECOTTON on LOCAL / HLOCAL / HLOCA / DLOCA is handling and storage, counted once. Houston data is currently returned as HLOCA.</p>
   {!!missing&&<p role="status" className={styles.hint}>{num(missing)} transport orders lack verified current-movement pay. Their revenue is retained; no carrier cost is assumed. GP below covers verified-pay orders only.</p>}
   {!!linksMissing&&<p className={styles.hint}>Some customer bridge targets are not present in this snapshot. Those accounts remain separate.</p>}
   {!!val(metrics,'warehouseHeaderIssues')&&<p role="status">{num(val(metrics,'warehouseHeaderIssues'))} warehouse invoices need header reconciliation review.</p>}
   {selectedCode&&!selected?<section className={styles.panel}><button className={styles.back} onClick={()=>setSelectedCode(null)}>All customers</button><p>No activity for this customer in the selected terminal.</p></section>:<>
    {selected&&<section className={styles.panel}><button className={styles.back} onClick={()=>setSelectedCode(null)}>All customers</button><h2>{selected.name}</h2><p>{selected.accounts.join(' · ')} · {selected.locations.map(c=>c.warehouse).join(' + ')}</p></section>}
    <div className={styles.kpis}>
     <div><span>Handling & storage billed</span><strong>{compact(val(metrics,'warehouseRevenue'))}</strong></div>
     <div><span>Warehouse invoices</span><strong>{num(val(metrics,'warehouseOrders'))}</strong></div>
     <div><span>Cotton OTR revenue</span><strong>{compact(val(metrics,'otrRevenue'))}</strong></div>
     <div><span>Cotton dray revenue</span><strong>{compact(val(metrics,'drayRevenue'))}</strong></div>
     <div><span>Known-pay transport GP*</span><strong>{compact(cottonTransportGP(metrics))}</strong></div>
     <div><span>Contribution proxy†</span><strong>{compact(cottonContribution(metrics))}</strong></div>
    </div>
    <section className={styles.panel}><h2>Service breakdown</h2><Services metrics={metrics}/></section>
    {selected?<>
     <section className={styles.panel}><h2>Terminal comparison</h2><div className={styles.tableScroll}><table><thead><tr><th>Terminal</th><th>Warehouse billed</th><th>OTR revenue</th><th>Dray revenue</th><th>Transport GP*</th></tr></thead><tbody>{selected.locations.map(c=><tr key={c.warehouse}><td><button className={styles.back} onClick={()=>setTerminal(c.warehouse)}>{c.warehouse}</button></td><td>{money(val(c.metrics,'warehouseRevenue'))}</td><td>{money(val(c.metrics,'otrRevenue'))}</td><td>{money(val(c.metrics,'drayRevenue'))}</td><td>{money(cottonTransportGP(c.metrics))}</td></tr>)}</tbody></table></div></section>
     <section className={styles.panel}><h2>Warehouse charge detail</h2><p className={styles.hint}>Combined invoice revenue is included above. Storage and handling detail is shown only when all invoice charge lines in this view reconcile. Dallas detail is available from the supplied DLOCA export; other terminals may need the combined SQL export.</p><div className={styles.tableScroll}><table><thead><tr><th>Storage</th><th>Handling</th><th>Other warehouse fees</th><th>Invoices with detail</th></tr></thead><tbody><tr><td>{detail(metrics,'warehouseStorage')}</td><td>{detail(metrics,'warehouseHandling')}</td><td>{detail(metrics,'warehouseOther')}</td><td>{num(val(metrics,'warehouseDetailedOrders'))} / {num(val(metrics,'warehouseOrders'))}</td></tr></tbody></table></div></section>
     <section className={styles.panel}><h2>Monthly activity</h2><div className={styles.tableScroll}><table><thead><tr><th>Month</th><th>Warehouse billed</th><th>OTR revenue</th><th>Dray revenue</th><th>Transport GP*</th></tr></thead><tbody>{selected.months.map(m=>{const mm=Object.fromEntries(Object.entries(m).filter(([k])=>k!=='month')) as CottonMetrics;return <tr key={m.month}><td>{m.month}</td><td>{money(val(mm,'warehouseRevenue'))}</td><td>{money(val(mm,'otrRevenue'))}</td><td>{money(val(mm,'drayRevenue'))}</td><td>{money(cottonTransportGP(mm))}</td></tr>;})}</tbody></table></div></section>
    </>:<section className={styles.panel}><h2>Customer contribution</h2><p className={styles.hint}>{num(filtered.length)} customer relationships · Select a customer for account codes and monthly detail.</p><div className={styles.tableScroll}><table><thead><tr><th>Customer</th><th>Terminals</th><th>Warehouse billed</th><th>OTR revenue</th><th>Dray revenue</th><th>Transport GP*</th><th>Contribution proxy†</th></tr></thead><tbody>{filtered.map(c=><tr key={c.code}><td className={styles.customer}><button style={{background:'transparent',border:0,color:'inherit',padding:0,font:'inherit',textAlign:'left',cursor:'pointer'}} onClick={()=>setSelectedCode(c.code)}>{c.name}</button><small>{c.accounts.join(' · ')}</small></td><td>{c.locations.map(x=>x.warehouse).join(' + ')}</td><td>{money(val(c.metrics,'warehouseRevenue'))}</td><td>{money(val(c.metrics,'otrRevenue'))}</td><td>{money(val(c.metrics,'drayRevenue'))}</td><td>{money(cottonTransportGP(c.metrics))}</td><td>{money(cottonContribution(c.metrics))}</td></tr>)}</tbody></table></div></section>}
   </>}
  </>}
  <footer className={styles.foot}>* Transport GP uses current-movement override pay, not audited final settlements; missing pay is never assumed zero. Zero-revenue transport orders remain visible, including their verified costs. † Contribution proxy = eCotton warehouse invoice revenue + known-pay OTR and dray GP. It excludes warehouse operating expenses and separate contract-storage billing outside ECOTTON. Customer accounts merge only through explicit McLeod bridge IDs. Local codes identify terminals; DAVIS/DDRAY identify Dallas. MAIN without one recognized SCM stop remains Unassigned and is retained in All terminals. No invoice is counted in two service categories.</footer>
 </main>;
}
