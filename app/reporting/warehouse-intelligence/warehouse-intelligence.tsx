'use client';
import {useEffect,useMemo,useState} from 'react';
import styles from './warehouse-intelligence.module.css';
type Metrics=Record<string,number>;
type Month = {
  month: string;
  storage?: number;
  contractStorage?: number;
  handling?: number;
  drayage?: number;
  other?: number;
  chassis?: number;
  otrRevenue?: number;
  otrPay?: number;
  otrLoads?: number;
  unreconciled?: number;
};
type Customer={warehouse:string;code:string;name:string;otrCode:string;metrics:Metrics;months:Month[]};
const num=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const compact=(n:number)=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);
const val=(d:Customer,k:string)=>d.metrics[k]||0;
const indicator=(d:Customer)=>val(d,'storage')+val(d,'contractStorage')+val(d,'handling')+val(d,'otrRevenue')-val(d,'otrPay');
const metrics=['storage','contractStorage','handling','drayage','otrRevenue','otrPay'];
function BarChart({rows}:{rows:{name:string;value:number}[]}){const max=Math.max(...rows.map(x=>x.value),1);return <div className={styles.bars}>{rows.map((r,i)=><div className={styles.barrow} key={i}><span title={r.name}>{r.name}</span><div className={styles.track}><div style={{width:`${Math.max(0,r.value/max*100)}%`}}/></div><strong>{money(r.value)}</strong></div>)}</div>}
function Trend({months}:{months:Month[]}){const sorted=[...months].sort((a,b)=>a.month.localeCompare(b.month));const values=sorted.map(m=>(m.storage||0)+(m.contractStorage||0)+(m.handling||0)+(m.otrRevenue||0)-(m.otrPay||0));const max=Math.max(...values,1);return <div className={styles.trend}>{sorted.map((m,i)=><div key={m.month} className={styles.trendCol} title={`${m.month}: ${money(values[i])}`}><div style={{height:`${Math.max(2,values[i]/max*100)}%`}}/><small>{i%3===0?m.month.slice(2):''}</small></div>)}</div>}
type Relationship={id:string;name:string;locations:Customer[];metrics:Metrics;months:Month[]};
const metricSum=(items:Customer[])=>items.reduce<Metrics>((acc,c)=>{for(const [k,v] of Object.entries(c.metrics))acc[k]=(acc[k]||0)+v;return acc;},{});
const mergeMonths=(items:Customer[]):Month[]=>{
 const byMonth=new Map<string,Month>();
 for(const c of items)for(const m of c.months){
  const target=byMonth.get(m.month)||{month:m.month};
  for(const [k,v] of Object.entries(m))if(k!=='month'&&typeof v==='number'){
   const key=k as Exclude<keyof Month,'month'>;
   target[key]=(target[key]||0)+v;
  }
  byMonth.set(m.month,target);
 }
 return [...byMonth.values()].sort((a,b)=>a.month.localeCompare(b.month));
};
const relationshipKey=(c:Customer)=>c.name.trim().toLocaleLowerCase('en-US');
const combine=(items:Customer[],name=items[0]?.name||'Unknown'):Relationship=>({
 id:relationshipKey(items[0]),name,locations:items,metrics:metricSum(items),months:mergeMonths(items)
});
const relationshipVal=(r:Relationship,k:string)=>r.metrics[k]||0;
const relationshipIndicator=(r:Relationship)=>relationshipVal(r,'storage')+relationshipVal(r,'contractStorage')+relationshipVal(r,'handling')+relationshipVal(r,'otrRevenue')-relationshipVal(r,'otrPay');

export default function WarehouseIntelligence(){
 const [initialData,setInitialData]=useState<Customer[]>([]);
 const [loading,setLoading]=useState(true);
 const [loadError,setLoadError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/reporting/warehouse-intelligence',{cache:'no-store',signal:controller.signal})
   .then(async response=>{
     if(!response.ok)throw new Error(response.status===403?'Financial reporting access required.':'Unable to load financial report.');
     return response.json();
   })
   .then(result=>{if(!controller.signal.aborted)setInitialData(result.customers);})
   .catch(error=>{if(!controller.signal.aborted)setLoadError(error instanceof Error?error.message:'Unable to load financial report.');})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[]);
 const [warehouse,setWarehouse]=useState('All');
 const [query,setQuery]=useState('');
 const [sort,setSort]=useState('indicator');
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const relationships=useMemo(()=>{
  const groups=new Map<string,Customer[]>();
  for(const c of initialData){const key=relationshipKey(c);groups.set(key,[...(groups.get(key)||[]),c]);}
  return [...groups.values()].map(items=>combine(items));
 },[initialData]);
 const visible=useMemo(()=>relationships.flatMap(r=>{
  const locations=r.locations.filter(c=>warehouse==='All'||c.warehouse===warehouse);
  return locations.length?[combine(locations,r.name)]:[];
 }),[relationships,warehouse]);
 const filtered=useMemo(()=>visible.filter(r=>`${r.name} ${r.locations.map(c=>`${c.code} ${c.otrCode}`).join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>
  sort==='name'?a.name.localeCompare(b.name):sort==='storage'?relationshipVal(b,'storage')-relationshipVal(a,'storage'):sort==='otr'?relationshipVal(b,'otrRevenue')-relationshipVal(b,'otrPay')-relationshipVal(a,'otrRevenue')+relationshipVal(a,'otrPay'):relationshipIndicator(b)-relationshipIndicator(a)
 ),[visible,query,sort]);
 // Selection is by customer identity, not a location row. Location switches preserve it.
 const selected=selectedId?visible.find(r=>r.id===selectedId)||null:null;
 const total=(key:string)=>filtered.reduce((n,r)=>n+relationshipVal(r,key),0);
 const connectedGP=total('otrRevenue')-total('otrPay');
 const top=filtered.slice(0,10).map(r=>({name:r.name,value:relationshipIndicator(r)}));
 const customerBreakdown=selected?selected.locations.map(c=>({
  name:c.warehouse,storage:val(c,'storage'),contractStorage:val(c,'contractStorage'),handling:val(c,'handling'),drayage:val(c,'drayage'),otrGP:val(c,'otrRevenue')-val(c,'otrPay'),orders:val(c,'orders'),otrLoads:val(c,'otrLoads')
 })):[];
 return <main className={styles.shell}>
 <header className={styles.head}><div><p className={styles.eyebrow}>SCM / REPORTING & ANALYTICS</p><h1>Warehouse Intelligence</h1><p className={styles.sub}>Customer retention & financial contribution · Jan 2025 – Oct 20, 2026</p></div><div className={styles.tag}>Historical snapshot · Not live</div></header>
 {loading && <p role="status">Loading protected financial data…</p>}
 {loadError && <p role="alert">{loadError}</p>}
 <div className={styles.toolbar}>
  <div className={styles.segment} aria-label="Warehouse location filter">{['All','Savannah','Houston'].map(w=><button key={w} type="button" aria-pressed={warehouse===w} className={warehouse===w?styles.active:''} onClick={()=>setWarehouse(w)}>{w==='All'?'All locations':w}</button>)}</div>
  <input aria-label="Search customers" placeholder="Search customer or McLeod code…" value={query} onChange={e=>setQuery(e.target.value)}/>
  <select aria-label="Sort customers" value={sort} onChange={e=>setSort(e.target.value)}><option value="indicator">Sort: Contribution indicator</option><option value="storage">Sort: Storage revenue</option><option value="otr">Sort: OTR gross profit</option><option value="name">Sort: Customer name</option></select>
 </div>
 {!loading && !loadError && (selected? <section className={styles.panel}>
  <button className={styles.back} onClick={()=>setSelectedId(null)}>← All customers</button>
  <div className={styles.profileHead}><div><h2>{selected.name}</h2><p>{warehouse==='All'?'All SCM locations':warehouse} · {selected.locations.map(c=>`${c.warehouse}: 3PL ${c.code} / MAIN ${c.otrCode||'No bridge'}`).join(' · ')}</p></div><span>{num(relationshipVal(selected,'orders'))} 3PL orders</span></div>
  <div className={styles.kpis}><div><span>Storage</span><strong>{money(relationshipVal(selected,'storage'))}</strong></div><div><span>Contract storage</span><strong>{money(relationshipVal(selected,'contractStorage'))}</strong></div><div><span>Handling</span><strong>{money(relationshipVal(selected,'handling'))}</strong></div><div><span>Drayage revenue</span><strong>{money(relationshipVal(selected,'drayage'))}</strong></div><div><span>Warehouse OTR loads</span><strong>{num(relationshipVal(selected,'otrLoads'))}</strong></div><div><span>Estimated OTR GP*</span><strong>{money(relationshipVal(selected,'otrRevenue')-relationshipVal(selected,'otrPay'))}</strong></div></div>
  {warehouse==='All'&&customerBreakdown.length>1&&<div className={styles.locationCompare}><h3>Location comparison</h3><p className={styles.hint}>Select Savannah or Houston above to filter every metric and chart for this customer.</p><div className={styles.tableScroll}><table><thead><tr><th>Location</th><th>3PL orders</th><th>Storage</th><th>Contract storage</th><th>Handling</th><th>Drayage revenue</th><th>OTR GP*</th></tr></thead><tbody>{customerBreakdown.map(d=><tr key={d.name} onClick={()=>setWarehouse(d.name)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setWarehouse(d.name)}}><td>{d.name} →</td><td>{num(d.orders)}</td><td>{money(d.storage)}</td><td>{money(d.contractStorage)}</td><td>{money(d.handling)}</td><td>{money(d.drayage)}</td><td>{money(d.otrGP)}</td></tr>)}</tbody></table></div></div>}
  <div className={styles.columns}><article><h3>Revenue & cost breakdown</h3><BarChart rows={[{name:'Storage',value:relationshipVal(selected,'storage')},{name:'Contract storage',value:relationshipVal(selected,'contractStorage')},{name:'Handling',value:relationshipVal(selected,'handling')},{name:'Chassis',value:relationshipVal(selected,'chassis')},{name:'Other accessorials',value:relationshipVal(selected,'other')},{name:'Drayage base',value:relationshipVal(selected,'drayage')},{name:'OTR revenue',value:relationshipVal(selected,'otrRevenue')},{name:'OTR carrier pay',value:relationshipVal(selected,'otrPay')} ]}/></article><article><h3>Monthly activity · {warehouse==='All'?'Combined':warehouse}</h3><p className={styles.hint}>Storage + contract storage + handling billing + estimated warehouse-connected OTR GP</p><Trend months={selected.months}/><p className={styles.hint}>This trend is a contribution indicator, not net profit.</p></article></div>
 </section>:<>
 <div className={styles.kpis}><div><span>Customers</span><strong>{num(filtered.length)}</strong></div><div><span>Storage billed</span><strong>{compact(total('storage'))}</strong></div><div><span>Contract storage</span><strong>{compact(total('contractStorage'))}</strong></div><div><span>Handling billed</span><strong>{compact(total('handling'))}</strong></div><div><span>Drayage base revenue</span><strong>{compact(total('drayage'))}</strong></div><div><span>Connected OTR GP*</span><strong>{compact(connectedGP)}</strong></div></div>
 <div className={styles.columns}><section className={styles.panel}><h2>Customer ranking</h2><p className={styles.hint}>One row per customer relationship · {filtered.length} customers · Click to see combined and location-level details.</p><div className={styles.tableScroll}><table><thead><tr><th>Customer</th><th>Locations</th><th>Storage</th><th>Contract storage</th><th>Handling</th><th>Drayage rev.</th><th>OTR GP*</th><th>Indicator†</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id} onClick={()=>setSelectedId(r.id)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setSelectedId(r.id)}}><td className={styles.customer}>{r.name}<small>{r.locations.map(c=>c.code).join(' · ')}</small></td><td>{r.locations.map(c=>c.warehouse).join(' + ')}</td><td>{money(relationshipVal(r,'storage'))}</td><td>{money(relationshipVal(r,'contractStorage'))}</td><td>{money(relationshipVal(r,'handling'))}</td><td>{money(relationshipVal(r,'drayage'))}</td><td>{money(relationshipVal(r,'otrRevenue')-relationshipVal(r,'otrPay'))}</td><td><b>{money(relationshipIndicator(r))}</b> →</td></tr>)}</tbody></table></div></section><section className={styles.panel}><h2>Top 10 customer indicators</h2><p className={styles.hint}>Storage + contract storage + handling revenue + estimated connected OTR gross profit</p><BarChart rows={top}/><h3>Revenue mix</h3><BarChart rows={[{name:'Storage',value:total('storage')},{name:'Contract storage',value:total('contractStorage')},{name:'Handling',value:total('handling')},{name:'Drayage base',value:total('drayage')},{name:'OTR GP',value:connectedGP}]}/></section></div>
 </>)}
 <footer className={styles.foot}>* OTR gross profit is provisional: billed OTR revenue less movement.override_pay_amt, not audited final settlements. † The customer indicator mixes warehouse revenue with OTR gross profit; it is not net profit. Drayage carrier pay and warehouse operating expenses are not yet included. Source: McLeod CSV exports. Customer relationships are grouped by normalized customer name from the existing 3PL bridge export; different names are not automatically merged.</footer>
 </main>;
}
