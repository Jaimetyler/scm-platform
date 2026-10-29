'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {cottonServices,cottonTransportGP,cottonContribution,type CottonMetrics} from '@/lib/reporting/cotton';
import styles from '../warehouse-intelligence/warehouse-intelligence.module.css';
type Month={month:string;[key:string]:string|number};
type Account={scope:string;warehouse:string;code:string;name:string;accounts:string[];codes:string[];relationshipReview:boolean;metrics:CottonMetrics;months:Month[]};
type Customer={code:string;name:string;locations:Account[];metrics:CottonMetrics;months:Month[];accounts:string[]};
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
const compact=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(n);
const num=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const val=(m:CottonMetrics,k:string)=>m[k]||0;
const terminalLabel=(terminal:string)=>terminal;
const totalRevenue=(m:CottonMetrics)=>val(m,'warehouseRevenue')+val(m,'otrRevenue')+val(m,'drayRevenue');
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
function unitGroups(items:Account[]):Account[]{
 const groups=new Map<string,Account[]>();
 for(const item of items)groups.set(item.warehouse,[...(groups.get(item.warehouse)||[]),item]);
 return [...groups.entries()].map(([warehouse,rows])=>({...rows[0],warehouse,accounts:[...new Set(rows.flatMap(c=>c.accounts))],codes:[...new Set(rows.flatMap(c=>c.codes))],relationshipReview:rows.some(c=>c.relationshipReview),...sum(rows)}));
}
function detail(metrics:CottonMetrics,key:string){
 const count=val(metrics,'warehouseOrders');
 if(!count&&val(metrics,'contractDocuments'))return money(val(metrics,key));
 return count===0?'—':val(metrics,'warehouseDetailedOrders')===count?money(val(metrics,key)):'Pending charge detail';
}
function Services({metrics}:{metrics:CottonMetrics}){
 const transport=[{...cottonServices(metrics).find(r=>r.kind==='otr')!,label:'OTR · MAIN / TERRY / DAVIS'},...['localDray','directDray'].map(kind=>({kind,label:kind==='localDray'?'Local drayage':'Direct drayage · CNTR / other DDRAY',orders:val(metrics,kind+'Orders'),revenue:val(metrics,kind+'Revenue'),pay:val(metrics,kind+'Pay'),gp:val(metrics,kind+'RevenueWithPay')-val(metrics,kind+'Pay'),payMissing:val(metrics,kind+'PayMissing')}))];
 return <div className={styles.tableScroll}><table><thead><tr><th>Service</th><th>Orders / invoices</th><th>Billed revenue</th><th>Verified carrier pay</th><th>Known-pay GP*</th></tr></thead>
 <tbody><tr><td>Warehouse total</td><td>{num(val(metrics,'warehouseOrders'))}</td><td>{money(val(metrics,'warehouseRevenue'))}</td><td>—</td><td>—</td></tr>
 {[["Handling","warehouseHandling"],["Storage","warehouseStorage"],["Other warehouse fees","warehouseOther"]].map(([label,key])=><tr key={key}><td>{label}</td><td>—</td><td>{detail(metrics,key)}</td><td>—</td><td>—</td></tr>)}
 {!!val(metrics,'contractDocuments')&&<tr><td>Contract storage (included in Storage)</td><td>{num(val(metrics,'contractDocuments'))}</td><td>{money(val(metrics,'contractStorage'))}</td><td>—</td><td>—</td></tr>}
 {transport.map(r=><tr key={r.kind}><td>{r.label}</td><td>{num(r.orders)}</td><td>{money(r.revenue)}</td><td>{r.payMissing&&!Object.hasOwn(metrics,r.kind+'Pay')?'Pending cost':r.pay===null?'—':money(r.pay)}</td><td>{r.payMissing&&!Object.hasOwn(metrics,r.kind+'Pay')?'—':r.gp===null?'—':`${money(r.gp)}${r.payMissing?' *':''}`}</td></tr>)}</tbody></table></div>;
}
export default function BusinessIntelligence(){
 const [data,setData]=useState<Account[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [terminal,setTerminal]=useState('All'),[query,setQuery]=useState(''),[sort,setSort]=useState('contribution'),[selectedCode,setSelectedCode]=useState<string|null>(null);
 useEffect(()=>{const controller=new AbortController();
  fetch('/api/reporting/business-intelligence',{cache:'no-store',signal:controller.signal})
   .then(async r=>{if(!r.ok)throw Error(r.status===403?'Administrator access is required.':'Combined report could not be loaded.');return r.json();})
   .then(r=>{if(!controller.signal.aborted)setData(r.customers);})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message);})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[]);
 useEffect(()=>{if(selectedCode)window.scrollTo({top:0,behavior:'smooth'});},[selectedCode]);
 const [scope,setScope]=useState('All');
 const locationRows=useMemo(()=>data.filter(c=>(terminal==='All'||c.warehouse===terminal)&&(scope==='All'||c.scope===scope)),[data,terminal,scope]);
 const customers=useMemo(()=>{
  const groups=new Map<string,Account[]>();
  for(const c of locationRows)groups.set(c.code,[...(groups.get(c.code)||[]),c]);
  return [...groups.entries()].map(([code,locations]):Customer=>({code,name:locations[0].name,locations:unitGroups(locations),accounts:[...new Set(locations.flatMap(c=>c.accounts))],...sum(locations)}));
 },[locationRows]);
 const filtered=useMemo(()=>customers.filter(c=>`${c.name} ${c.code} ${c.accounts.join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='revenue'?cottonServices(b.metrics).reduce((n,r)=>n+r.revenue,0)-cottonServices(a.metrics).reduce((n,r)=>n+r.revenue,0):cottonContribution(b.metrics)-cottonContribution(a.metrics)),[customers,query,sort]);
 const selected=selectedCode?customers.find(c=>c.code===selectedCode):null;
 const total=sum(filtered.flatMap(c=>c.locations)).metrics;
 const metrics=selected?.metrics||total;
 const missing=val(metrics,'otrPayMissing')+val(metrics,'drayPayMissing');
 const linksMissing=(selected?selected.locations:filtered.flatMap(c=>c.locations)).filter(c=>c.relationshipReview).length;
 return <main className={styles.shell}>
  <header className={styles.head}><div><p className={styles.eyebrow}>SCM / REPORTING & ANALYTICS</p><h1>SCM Business Intelligence</h1><p className={styles.sub}>All-customer warehouse billing and trucking · Jan 2025 – Oct 20, 2026 · Bill-date basis</p></div><div className={styles.tag}>Loaded-source snapshot · Not live</div></header>
  <p><Link style={{color:'#67e8f9'}} href="/reporting/cotton-intelligence">Cotton Intelligence</Link> · <Link style={{color:'#67e8f9'}} href="/reporting/warehouse-intelligence">Warehouse Intelligence</Link> · <Link style={{color:'#67e8f9'}} href="/">Platform home</Link></p>
  {loading&&<p role="status">Loading protected business data…</p>}
  {error&&<p role="alert">{error}</p>}
  <div className={styles.toolbar}><div className={styles.segment} aria-label="Commodity scope">{['All','Cotton','Non-Cotton',...(data.some(c=>c.scope==='Unclassified')?['Unclassified']:[])].map(value=><button key={value} type="button" aria-pressed={scope===value} className={scope===value?styles.active:''} onClick={()=>setScope(value)}>{value==='All'?'All business':value}</button>)}</div></div>
  <div className={styles.toolbar}>
   <div className={styles.segment} aria-label="Business unit filter">{['All','Savannah','Houston','Dallas','Brokerage'].map(t=><button key={t} type="button" aria-pressed={terminal===t} className={terminal===t?styles.active:''} onClick={()=>setTerminal(t)}>{t==='All'?'All business units':terminalLabel(t)}</button>)}</div>
   <input aria-label="Search customers" placeholder="Search customer, account or bridge…" value={query} onChange={e=>{setQuery(e.target.value);setSelectedCode(null);}}/>
   <select aria-label="Sort customers" value={sort} onChange={e=>setSort(e.target.value)}><option value="contribution">Sort: Contribution proxy</option><option value="revenue">Sort: Billed revenue</option><option value="name">Sort: Customer name</option></select>
  </div>
  {!loading&&!error&&<>
   <p className={styles.hint}>Savannah, Houston, Dallas, and Brokerage are business units. Trucking is assigned by its SCM warehouse pickup or delivery, regardless of revenue code. OTR includes MAIN / TERRY / DAVIS; CNTR is direct drayage. DDRAY touching SCM Dallas is local drayage; other DDRAY moves remain direct. Local drayage also includes warehouse local moves and warehouse-invoice trucking billing. Confirmed non-cotton accounts remain in the overall business.</p>
   <p role="status" className={styles.hint}>Source coverage: full MAIN / TERRY / DAVIS / CNTR / DDRAY exports, cotton local drays, the non-cotton local trucking compact export, and the supplied warehouse and contract-storage billing. This covers the loaded revenue-code sources for the stated period; it is not a certified company ledger.</p>
   {!!val(metrics,'unclassifiedContractRevenue')&&<p className={styles.hint}>Contract storage of {money(val(metrics,'unclassifiedContractRevenue'))} is included in All business and Unclassified. These invoices have no commodity allocation and are excluded from the Cotton and Non-Cotton filters.</p>}
   {!!(val(metrics,'allocationReviewLoads')+val(metrics,'allocationReviewContracts'))&&<p role="status" className={styles.hint}>{num(val(metrics,'allocationReviewLoads'))} inter-warehouse loads and {num(val(metrics,'allocationReviewContracts'))} contract documents need business-unit allocation. Included once in company totals; not assigned to a unit. <button type="button" className={styles.back} style={{marginBottom:0}} onClick={()=>setTerminal('Allocation review')}>View allocation review</button></p>}
   {!!val(metrics,'warehouseUnclassifiedRevenue')&&<p className={styles.hint}>{money(val(metrics,'warehouseUnclassifiedRevenue'))} of invoice revenue lacks a reconciled warehouse charge classification and stays in Other; invoice totals remain included.</p>}
   {!!missing&&<p role="status" className={styles.hint}>{num(missing)} transport loads or warehouse trucking-billing records lack verified carrier cost. Revenue is retained; no carrier cost is assumed. GP covers verified-pay loads only. Warehouse trucking invoice billing is not counted as an additional transport load.</p>}
   {!!linksMissing&&<p className={styles.hint}>Some customer bridge targets are not present in this snapshot. Those accounts remain separate.</p>}
   {!!val(metrics,'warehouseHeaderIssues')&&<p role="status">{num(val(metrics,'warehouseHeaderIssues'))} warehouse invoices need header reconciliation review.</p>}
   {selectedCode&&!selected?<section className={styles.panel}><button className={styles.back} onClick={()=>setSelectedCode(null)}>All customers</button><p>No activity for this customer in the selected business unit or commodity scope.</p></section>:<>
    {selected&&<section className={styles.panel}><button className={styles.back} onClick={()=>setSelectedCode(null)}>All customers</button><h2>{selected.name}</h2><p>{selected.accounts.join(' · ')} · {selected.locations.map(c=>terminalLabel(c.warehouse)).join(' + ')} · {scope==='All'?'All commodity scopes':scope}</p></section>}
    <div className={styles.kpis}>
     <div><span>Total billed revenue</span><strong>{compact(totalRevenue(metrics))}</strong></div>
     <div><span>Warehouse total billed</span><strong>{compact(val(metrics,'warehouseRevenue'))}</strong></div>
     <div><span>Handling billed</span><strong style={{fontSize:18}}>{detail(metrics,'warehouseHandling')}</strong></div>
     <div><span>Storage billed</span><strong style={{fontSize:18}}>{detail(metrics,'warehouseStorage')}</strong></div>
     <div><span>Other warehouse fees</span><strong style={{fontSize:18}}>{detail(metrics,'warehouseOther')}</strong></div>
     <div><span>Warehouse invoices</span><strong>{num(val(metrics,'warehouseOrders'))}</strong></div>
     <div><span>OTR trucking revenue</span><strong>{compact(val(metrics,'otrRevenue'))}</strong></div>
     <div><span>Local drayage revenue</span><strong>{compact(val(metrics,'localDrayRevenue'))}</strong></div>
     <div><span>Direct drayage revenue</span><strong>{compact(val(metrics,'directDrayRevenue'))}</strong></div>
     <div><span>Known-pay transport GP*</span><strong>{compact(cottonTransportGP(metrics))}</strong></div>
     <div><span>Contribution proxy†</span><strong>{compact(cottonContribution(metrics))}</strong></div>
    </div>
    <section className={styles.panel}><h2>Service breakdown</h2><p className={styles.hint}>Handling includes receiving and shipping; storage includes storage credits and contract storage. Other fees stay separate. The three categories are components of the warehouse total, not additional revenue. Split available for {num(val(metrics,'warehouseDetailedOrders'))} of {num(val(metrics,'warehouseOrders'))} invoices; incomplete views show Pending charge detail.</p><Services metrics={metrics}/></section>
    {selected?<>
     <section className={styles.panel}><h2>Business unit comparison</h2><div className={styles.tableScroll}><table><thead><tr><th>Business unit</th><th>Warehouse total</th><th>Handling</th><th>Storage</th><th>Other warehouse fees</th><th>OTR revenue</th><th>Local drayage</th><th>Direct drayage</th><th>Transport GP*</th></tr></thead><tbody>{selected.locations.map(c=><tr key={c.warehouse}><td><button className={styles.back} onClick={()=>setTerminal(c.warehouse)}>{terminalLabel(c.warehouse)}</button></td><td>{money(val(c.metrics,'warehouseRevenue'))}</td><td>{detail(c.metrics,'warehouseHandling')}</td><td>{detail(c.metrics,'warehouseStorage')}</td><td>{detail(c.metrics,'warehouseOther')}</td><td>{money(val(c.metrics,'otrRevenue'))}</td><td>{money(val(c.metrics,'localDrayRevenue'))}</td><td>{money(val(c.metrics,'directDrayRevenue'))}</td><td>{money(cottonTransportGP(c.metrics))}</td></tr>)}</tbody></table></div></section>
     <section className={styles.panel}><h2>Warehouse charge detail</h2><p className={styles.hint}>Warehouse service billing is included above. Handling, storage, and other fees reconcile to the loaded invoice controls; any unclassified residual is identified separately. Includes warehouse billing and contract storage from loaded sources. Warehouse total excludes trucking components billed on warehouse invoices; those appear under drayage revenue with carrier cost unverified. Shared customer accounts are grouped only through verified links.</p><div className={styles.tableScroll}><table><thead><tr><th>Storage</th><th>Handling</th><th>Other warehouse fees</th><th>Invoices with detail</th></tr></thead><tbody><tr><td>{detail(metrics,'warehouseStorage')}</td><td>{detail(metrics,'warehouseHandling')}</td><td>{detail(metrics,'warehouseOther')}</td><td>{num(val(metrics,'warehouseDetailedOrders'))} / {num(val(metrics,'warehouseOrders'))}</td></tr></tbody></table></div></section>
     <section className={styles.panel}><h2>Monthly activity</h2><div className={styles.tableScroll}><table><thead><tr><th>Month</th><th>Warehouse total</th><th>Handling</th><th>Storage</th><th>Other warehouse fees</th><th>OTR revenue</th><th>Local drayage</th><th>Direct drayage</th><th>Transport GP*</th></tr></thead><tbody>{selected.months.map(m=>{const mm=Object.fromEntries(Object.entries(m).filter(([k])=>k!=='month')) as CottonMetrics;return <tr key={m.month}><td>{m.month}</td><td>{money(val(mm,'warehouseRevenue'))}</td><td>{detail(mm,'warehouseHandling')}</td><td>{detail(mm,'warehouseStorage')}</td><td>{detail(mm,'warehouseOther')}</td><td>{money(val(mm,'otrRevenue'))}</td><td>{money(val(mm,'localDrayRevenue'))}</td><td>{money(val(mm,'directDrayRevenue'))}</td><td>{money(cottonTransportGP(mm))}</td></tr>;})}</tbody></table></div></section>
    </>:<section className={styles.panel}><h2>Customer contribution</h2><p className={styles.hint}>{num(filtered.length)} customer relationships · Click a customer row or View customer for account codes and monthly detail.</p><div className={styles.tableScroll}><table><thead><tr><th>Customer</th><th>Business units</th><th>Warehouse total</th><th>Handling</th><th>Storage</th><th>Other warehouse fees</th><th>OTR revenue</th><th>Local drayage</th><th>Direct drayage</th><th>Transport GP*</th><th>Contribution proxy†</th><th>Details</th></tr></thead><tbody>{filtered.map(c=><tr key={c.code} tabIndex={0} aria-label={`Open customer ${c.name}`} onClick={()=>setSelectedCode(c.code)} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setSelectedCode(c.code);}}}><td className={styles.customer}><button style={{background:'transparent',border:0,color:'inherit',padding:0,font:'inherit',textAlign:'left',cursor:'pointer'}} onClick={()=>setSelectedCode(c.code)}>{c.name}</button><small>{c.accounts.join(' · ')}</small></td><td>{c.locations.map(x=>terminalLabel(x.warehouse)).join(' + ')}</td><td>{money(val(c.metrics,'warehouseRevenue'))}</td><td>{detail(c.metrics,'warehouseHandling')}</td><td>{detail(c.metrics,'warehouseStorage')}</td><td>{detail(c.metrics,'warehouseOther')}</td><td>{money(val(c.metrics,'otrRevenue'))}</td><td>{money(val(c.metrics,'localDrayRevenue'))}</td><td>{money(val(c.metrics,'directDrayRevenue'))}</td><td>{money(cottonTransportGP(c.metrics))}</td><td>{money(cottonContribution(c.metrics))}</td><td><button type="button" className={styles.back} style={{marginBottom:0,whiteSpace:'nowrap'}} aria-label={`View customer ${c.name}`} onClick={()=>setSelectedCode(c.code)}>View customer →</button></td></tr>)}</tbody></table></div></section>}
   </>}
  </>}
  <footer className={styles.foot}>* Transport GP uses current-movement override pay, not audited final settlements; missing pay is never assumed zero. Zero-revenue transport orders remain visible, including their verified costs. † Contribution proxy = warehouse service billing + known-pay OTR and dray GP. It excludes warehouse operating expenses and the unverified margin on warehouse trucking invoice billing. Contract storage is included once using the confirmed customer classification: Performance Additives and the two Binder accounts are non-cotton; the other confirmed contract-storage accounts are cotton. New unclassified accounts remain reviewable. Customer accounts merge only through explicit McLeod bridge IDs. An SCM warehouse endpoint takes priority over revenue code for unit assignment. Moves without a recognized SCM endpoint fall under Brokerage, except warehouse local-code routing. Location mappings remain reviewable. Moves between SCM warehouses are credited once to the receiving warehouse at delivery, including revenue and verified carrier pay. Invoice components may span services; no revenue is counted twice.</footer>
 </main>;
}
