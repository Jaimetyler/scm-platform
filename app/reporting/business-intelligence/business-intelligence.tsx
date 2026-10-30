'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {businessRevenue,businessTransport,businessPeriodRows,type BusinessMetrics} from '@/lib/reporting/business';
import view from './business-intelligence.module.css';
import styles from '../warehouse-intelligence/warehouse-intelligence.module.css';
type Month={month:string;[key:string]:string|number};
type Account={scope:string;warehouse:string;code:string;name:string;accounts:string[];codes:string[];relationshipReview:boolean;metrics:BusinessMetrics;months:Month[]};
type Customer={code:string;name:string;locations:Account[];metrics:BusinessMetrics;months:Month[];accounts:string[]};
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
const compact=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(n);
const num=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const val=(m:BusinessMetrics,k:string)=>m[k]||0;
const terminalLabel=(terminal:string)=>terminal;
const totalRevenue=businessRevenue;
function sum(items:Account[]) {
 const metrics:BusinessMetrics={},months=new Map<string,Month>();
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
function detail(metrics:BusinessMetrics,key:string){
 const count=val(metrics,'warehouseOrders');
 if(!count&&val(metrics,'contractDocuments'))return money(val(metrics,key));
 return count===0?'—':val(metrics,'warehouseDetailedOrders')===count?money(val(metrics,key)):'Pending charge detail';
}
function ChassisValue({metrics,complete}:{metrics:BusinessMetrics;complete:boolean}){
 return <>{complete||val(metrics,'chassisChargeLines')?money(val(metrics,'chassisBilled')):'Pending export'}{!complete&&<small className={view.componentNote}>Partial · warehouse export only</small>}</>;
}
function TransportValue({metrics,prefix}:{metrics:BusinessMetrics;prefix:string}){
 const row=businessTransport(metrics).find(r=>r.prefix===prefix)!;
 return <><span className={view.cellRevenue}>{money(row.revenue)}</span><small className={view.cellGP}>Order GP: {row.gp===null?'Not available':money(row.gp)}{row.missing?' *':''}</small></>;
}
function TruckingPerformance({metrics}:{metrics:BusinessMetrics}){
 return <section><h2>Trucking performance</h2><div className={view.transport}>{businessTransport(metrics).map(row=><article key={row.prefix}><h3>{row.label}</h3><p>{num(row.orders)} transport loads</p><div className={view.performance}><div><span>Billed revenue</span><strong>{compact(row.revenue)}</strong></div><div><span>Verified carrier pay</span><strong>{row.pay===null?'Pending cost':money(row.pay)}</strong></div><div><span>Known-pay order GP</span><strong className={view.profit} style={row.gp!==null&&row.gp<0?{color:'#fda4af'}:undefined}>{row.gp===null?'Not available':money(row.gp)}</strong></div></div>{!!row.missing&&<p>{num(row.missing)} loads or warehouse billing records lack verified cost; GP uses {money(row.coveredRevenue)} of revenue with verified cost.</p>}</article>)}</div></section>;
}
function Services({metrics,chassisComplete}:{metrics:BusinessMetrics;chassisComplete:boolean}){
 return <div className={styles.tableScroll}><table><thead><tr><th>Service</th><th>Orders / invoices</th><th>Billed revenue</th><th>Verified carrier pay</th><th>Known-pay order GP*</th></tr></thead>
 <tbody><tr><td>Warehouse services total</td><td>{num(val(metrics,'warehouseOrders'))}</td><td>{money(val(metrics,'warehouseRevenue'))}</td><td>—</td><td>—</td></tr>
 {[["Handling","warehouseHandling"],["Storage","warehouseStorage"],["Other warehouse fees","warehouseOther"]].map(([label,key])=><tr key={key}><td>{label}</td><td>—</td><td>{detail(metrics,key)}</td><td>—</td><td>—</td></tr>)}
 {!!val(metrics,'contractDocuments')&&<tr><td>Contract storage (included in Storage)</td><td>{num(val(metrics,'contractDocuments'))}</td><td>{money(val(metrics,'contractStorage'))}</td><td>—</td><td>—</td></tr>}
 {businessTransport(metrics).map(row=><tr key={row.prefix}><td>{row.label}</td><td>{num(row.orders)}</td><td>{money(row.revenue)}</td><td>{row.pay===null?'Pending cost':money(row.pay)}</td><td>{row.gp===null?'—':money(row.gp)}{row.missing?' *':''}</td></tr>)}
 <tr><td>Chassis billed (included in invoice revenue)</td><td>{num(val(metrics,'chassisChargeLines'))} charge lines</td><td><ChassisValue metrics={metrics} complete={chassisComplete}/></td><td>—</td><td>Not calculated</td></tr>
 </tbody></table></div>;
}
export default function BusinessIntelligence(){
 const [data,setData]=useState<Account[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [terminal,setTerminal]=useState('All'),[query,setQuery]=useState(''),[sort,setSort]=useState('revenue'),[selectedCode,setSelectedCode]=useState<string|null>(null);
 useEffect(()=>{const controller=new AbortController();
  fetch('/api/reporting/business-intelligence',{cache:'no-store',signal:controller.signal})
   .then(async r=>{if(!r.ok)throw Error(r.status===403?'Administrator access is required.':'Combined report could not be loaded.');return r.json();})
   .then(r=>{if(!controller.signal.aborted){setData(r.customers);setChassisComplete(r.chassisCoverage==='complete');}})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message);})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[]);
 useEffect(()=>{if(selectedCode)window.scrollTo({top:0,behavior:'smooth'});},[selectedCode]);
 const [mixKey,setMixKey]=useState('total');
 const [scope,setScope]=useState('All');
 const [chassisComplete,setChassisComplete]=useState(false);
 const [fromMonth,setFromMonth]=useState(''),[toMonth,setToMonth]=useState('');
 const availableMonths=useMemo(()=>[...new Set(data.flatMap(c=>c.months.map(m=>m.month)))].sort(),[data]);
 const firstMonth=availableMonths[0]||'2025-01',lastMonth=availableMonths.at(-1)||'2026-10';
 const startMonth=fromMonth||firstMonth,endMonth=toMonth||lastMonth;
 const validMonth=(month:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(month);
 const dateError=!validMonth(startMonth)||!validMonth(endMonth)?'Enter valid start and end months.':startMonth>endMonth?'The start month must be before or equal to the end month.':startMonth<firstMonth||endMonth>lastMonth?`This snapshot covers ${firstMonth} through ${lastMonth}.`:'';
 const periodRows=useMemo(()=>dateError?[]:businessPeriodRows(data,startMonth,endMonth),[data,startMonth,endMonth,dateError]);
 const locationRows=useMemo(()=>periodRows.filter(c=>(terminal==='All'||c.warehouse===terminal)&&(scope==='All'||c.scope===scope)),[periodRows,terminal,scope]);
 const years=[...new Set(availableMonths.map(m=>m.slice(0,4)))];
 const customers=useMemo(()=>{
  const groups=new Map<string,Account[]>();
  for(const c of locationRows)groups.set(c.code,[...(groups.get(c.code)||[]),c]);
  return [...groups.entries()].map(([code,locations]):Customer=>({code,name:locations[0].name,locations:unitGroups(locations),accounts:[...new Set(locations.flatMap(c=>c.accounts))],...sum(locations)}));
 },[locationRows]);
 const filtered=useMemo(()=>customers.filter(c=>`${c.name} ${c.code} ${c.accounts.join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>{
  if(sort==='name')return a.name.localeCompare(b.name);
  const rank=(m:BusinessMetrics)=>sort==='otrGP'?businessTransport(m)[0].gp:sort==='localGP'?businessTransport(m)[1].gp:sort==='directGP'?businessTransport(m)[2].gp:totalRevenue(m);
  const left=rank(a.metrics),right=rank(b.metrics);
  return left===null?(right===null?0:1):right===null?-1:right-left;
 }),[customers,query,sort]);
 const selected=selectedCode?customers.find(c=>c.code===selectedCode):null;

 const mixOptions=[['total','Total billed revenue'],['otrRevenue','OTR trucking'],['localDrayRevenue','Local drayage'],['directDrayRevenue','Direct drayage'],['warehouseRevenue','Warehouse services'],['warehouseHandling','Handling'],['warehouseStorage','Storage'],['warehouseOther','Other warehouse fees']] as const;
 const mixAmount=(m:BusinessMetrics)=>mixKey==='total'?totalRevenue(m):val(m,mixKey);
 const mixRanked=[...customers].map(customer=>({customer,amount:mixAmount(customer.metrics)})).filter(item=>item.amount>0).sort((a,b)=>b.amount-a.amount);
 const mixDenominator=mixRanked.reduce((n,item)=>n+item.amount,0);
 const mixSegments=[...mixRanked.slice(0,7).map(item=>({name:item.customer.name,amount:item.amount})),...(mixRanked.length>7?[{name:'Other customers',amount:mixRanked.slice(7).reduce((n,item)=>n+item.amount,0)}]:[])];
 const mixColors=['#38bdf8','#2dd4bf','#a78bfa','#fbbf24','#fb7185','#818cf8','#4ade80','#64748b'];
 let mixCursor=0;
 const mixGradient=mixDenominator>0?'conic-gradient('+mixSegments.map((segment,i)=>{const start=mixCursor;mixCursor+=100*segment.amount/mixDenominator;return mixColors[i%mixColors.length]+' '+start+'% '+mixCursor+'%';}).join(',')+')':'conic-gradient(#334155 0% 100%)';
 const selectedUnitRows=selected?['Savannah','Houston','Dallas','Brokerage'].map(unit=>{
  const unitRows=periodRows.filter(row=>row.warehouse===unit&&(scope==='All'||row.scope===scope));
  const denominator=totalRevenue(sum(unitRows).metrics);
  const customerAmount=totalRevenue(sum(unitRows.filter(row=>row.code===selected.code)).metrics);
  return {unit,denominator,customerAmount,share:denominator>0?100*customerAmount/denominator:null};
 }):[];

 const total=sum(filtered.flatMap(c=>c.locations)).metrics;
 const metrics=selected?.metrics||total;
 const missing=val(metrics,'otrPayMissing')+val(metrics,'drayPayMissing');
 const linksMissing=(selected?selected.locations:filtered.flatMap(c=>c.locations)).filter(c=>c.relationshipReview).length;
 return <main className={styles.shell}>
  <header className={styles.head}><div><p className={styles.eyebrow}>SCM / REPORTING & ANALYTICS</p><h1>SCM Business Intelligence</h1><p className={styles.sub}>All-customer warehouse billing and trucking · {startMonth} through {endMonth} · Monthly bill-date basis</p></div><div className={view.headerActions}><Link className={view.guideButton} href="/reporting/business-intelligence/guide"><span aria-hidden="true">▤</span> How this report works <span aria-hidden="true">→</span></Link><div className={styles.tag}>Loaded-source snapshot · Not live</div></div></header>
  <p><Link style={{color:'#67e8f9'}} href="/">Platform home</Link></p>
  {loading&&<p role="status">Loading protected business data…</p>}
  {error&&<p role="alert">{error}</p>}
  <div className={view.dateFilter} role="group" aria-label="Report month range">
   <label>From month<input aria-label="From month" type="month" min={firstMonth} max={lastMonth} value={startMonth} onChange={e=>setFromMonth(e.target.value)}/></label>
   <label>Through month<input aria-label="Through month" type="month" min={firstMonth} max={lastMonth} value={endMonth} onChange={e=>setToMonth(e.target.value)}/></label>
   <div className={styles.segment} role="group" aria-label="Quick period"><button type="button" aria-pressed={startMonth===firstMonth&&endMonth===lastMonth} onClick={()=>{setFromMonth('');setToMonth('');}}>All available</button>{years.map(year=><button key={year} type="button" aria-pressed={startMonth===(year+'-01'<firstMonth?firstMonth:year+'-01')&&endMonth===(year+'-12'>lastMonth?lastMonth:year+'-12')} onClick={()=>{setFromMonth(year+'-01'<firstMonth?firstMonth:year+'-01');setToMonth(year+'-12'>lastMonth?lastMonth:year+'-12');}}>{year}</button>)}</div>
  </div>
  <p className={styles.hint}>Available snapshot: {firstMonth} through {lastMonth}. Filters use whole billed months; October 2026 includes data through October 20 only.</p>
  {dateError&&<p role="alert">{dateError}</p>}
  <div className={styles.toolbar}><div className={styles.segment} aria-label="Commodity scope">{['All','Cotton','Non-Cotton',...(data.some(c=>c.scope==='Unclassified')?['Unclassified']:[])].map(value=><button key={value} type="button" aria-pressed={scope===value} className={scope===value?styles.active:''} onClick={()=>setScope(value)}>{value==='All'?'All business':value}</button>)}</div></div>
  <div className={styles.toolbar}>
   <div className={styles.segment} aria-label="Business unit filter">{['All','Savannah','Houston','Dallas','Brokerage'].map(t=><button key={t} type="button" aria-pressed={terminal===t} className={terminal===t?styles.active:''} onClick={()=>setTerminal(t)}>{t==='All'?'All business units':terminalLabel(t)}</button>)}</div>
   <input aria-label="Search customers" placeholder="Search customer, account or bridge…" value={query} onChange={e=>{setQuery(e.target.value);setSelectedCode(null);}}/>
   <select aria-label="Sort customers" value={sort} onChange={e=>setSort(e.target.value)}><option value="revenue">Sort: Billed revenue</option><option value="name">Sort: Customer name</option><option value="otrGP">Sort: OTR order GP</option><option value="localGP">Sort: Local drayage order GP</option><option value="directGP">Sort: Direct drayage order GP</option></select>
  </div>
  {!loading&&!error&&!dateError&&<>
   {!chassisComplete&&<p role="status" className={styles.hint}>Chassis coverage is partial: loaded Savannah/Houston warehouse charges only. Full trucking-code chassis billing awaits the compact chassis export. The known subtotal is already in billed revenue and is not added again.</p>}
   {!!val(metrics,'chassisUnmappedCodeLines')&&<p role="status" className={styles.hint}>{num(val(metrics,'chassisUnmappedCodeLines'))} chassis charge lines need a revenue-code business-unit mapping. <button type="button" className={styles.back} style={{marginBottom:0}} onClick={()=>setTerminal('Allocation review')}>View chassis allocation review</button></p>}
   {!!val(metrics,'unclassifiedContractRevenue')&&<p className={styles.hint}>Contract storage of {money(val(metrics,'unclassifiedContractRevenue'))} is included in All business and Unclassified. These invoices have no commodity allocation and are excluded from the Cotton and Non-Cotton filters.</p>}
   {!!(val(metrics,'allocationReviewLoads')+val(metrics,'allocationReviewContracts'))&&<p role="status" className={styles.hint}>{num(val(metrics,'allocationReviewLoads'))} inter-warehouse loads and {num(val(metrics,'allocationReviewContracts'))} contract documents need business-unit allocation. Included once in company totals; not assigned to a unit. <button type="button" className={styles.back} style={{marginBottom:0}} onClick={()=>setTerminal('Allocation review')}>View allocation review</button></p>}
   {!!val(metrics,'warehouseUnclassifiedRevenue')&&<p className={styles.hint}>{money(val(metrics,'warehouseUnclassifiedRevenue'))} of invoice revenue lacks a reconciled warehouse charge classification and stays in Other; invoice totals remain included.</p>}
   {!!missing&&<p role="status" className={styles.hint}>{num(missing)} transport loads or warehouse trucking-billing records lack verified carrier cost. Revenue is retained; no carrier cost is assumed. GP covers verified-pay loads only. Warehouse trucking invoice billing is not counted as an additional transport load.</p>}
   {!!linksMissing&&<p className={styles.hint}>Some customer bridge targets are not present in this snapshot. Those accounts remain separate.</p>}
   {!!val(metrics,'warehouseHeaderIssues')&&<p role="status">{num(val(metrics,'warehouseHeaderIssues'))} warehouse invoices need header reconciliation review.</p>}
   {selectedCode&&!selected?<section className={styles.panel}><button className={styles.back} onClick={()=>setSelectedCode(null)}>All customers</button><p>No activity for this customer in the selected month range, business unit, or commodity scope.</p></section>:<>

    {selected&&<section className={styles.panel} style={{border:'2px solid #38bdf8',padding:24}}>
      <button type="button" className={styles.back} onClick={()=>setSelectedCode(null)}>← Back to all customers</button>
      <p className={styles.eyebrow}>Business Intelligence / Customer detail</p>
      <h1 style={{fontSize:32,margin:'10px 0'}}>{selected.name}</h1>
      <p>{selected.accounts.join(' · ')} · {scope==='All'?'All commodity scopes':scope} · {startMonth} through {endMonth}</p>
      <h2>Customer share of business-unit revenue</h2>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
       {selectedUnitRows.map(item=><div key={item.unit} style={{padding:14,border:'1px solid #475569',borderRadius:10}}>
        <strong>{item.unit}</strong><p style={{fontSize:26,fontWeight:800,margin:'8px 0'}}>{item.share===null?'—':item.share.toFixed(1)+'%'}</p>
        <small>{money(item.customerAmount)} of {money(item.denominator)}</small>
       </div>)}
      </div>
      <p className={styles.hint}>Each percentage is the customer's billed revenue divided by that unit's total billed revenue for the selected dates and commodity scope. Units without revenue show —.</p>
    </section>}
    {!selected&&<section className={styles.panel}>
      <h2>Customer revenue mix</h2>
      <p className={styles.hint}>Revenue concentration across all customers in the selected business unit, dates, and commodity scope. Searching the customer table does not change these percentages.</p>
      <label>Revenue category <select aria-label="Customer mix revenue category" value={mixKey} onChange={e=>setMixKey(e.target.value)}>{mixOptions.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <div style={{display:'flex',flexWrap:'wrap',gap:24,alignItems:'center',marginTop:20}}>
       <div role="img" aria-label="Customer revenue share pie chart" style={{width:220,height:220,borderRadius:'50%',background:mixGradient,flexShrink:0}}/>
       <div style={{flex:'1 1 350px',minWidth:0}}>
        <h3>{money(mixDenominator)} total</h3>
        <div className={styles.tableScroll}><table><thead><tr><th>Customer</th><th>Billed revenue</th><th>Share</th></tr></thead>
         <tbody>{mixRanked.map(({customer,amount})=><tr key={customer.code}><td><button type="button" style={{background:'transparent',border:0,color:'#67e8f9',cursor:'pointer',textAlign:'left'}} onClick={()=>setSelectedCode(customer.code)}>{customer.name}</button></td><td>{money(amount)}</td><td>{mixDenominator>0?(100*amount/mixDenominator).toFixed(1)+'%':'—'}</td></tr>)}</tbody>
        </table></div>
       </div>
      </div>
      {mixDenominator===0&&<p className={styles.hint}>No revenue in this category for the selected period.</p>}
    </section>}

    <div className={styles.kpis}>
     <div><span>Total billed revenue</span><strong>{compact(totalRevenue(metrics))}</strong></div>
     <div><span>Warehouse services billed</span><strong>{compact(val(metrics,'warehouseRevenue'))}</strong></div>
     <div><span>Handling billed</span><strong style={{fontSize:18}}>{detail(metrics,'warehouseHandling')}</strong></div>
     <div><span>Storage billed</span><strong style={{fontSize:18}}>{detail(metrics,'warehouseStorage')}</strong></div>
     <div><span>Other warehouse fees</span><strong style={{fontSize:18}}>{detail(metrics,'warehouseOther')}</strong></div>
     <div><span>Chassis billed · included in invoice revenue</span><strong style={{fontSize:18}}><ChassisValue metrics={metrics} complete={chassisComplete}/></strong><small className={view.componentNote}>Revenue only · no separate profit</small></div>
    </div>
    <TruckingPerformance metrics={metrics}/>
    <section className={styles.panel}><h2>Service breakdown</h2><Services metrics={metrics} chassisComplete={chassisComplete}/></section>
    {selected?<>
     <section className={styles.panel}><h2>Business unit comparison</h2><div className={styles.tableScroll}><table><thead><tr><th>Business unit</th><th>Warehouse total</th><th>Handling</th><th>Storage</th><th>Other warehouse fees</th><th>Chassis billed*</th><th>OTR revenue / order GP</th><th>Local drayage revenue / order GP</th><th>Direct drayage revenue / order GP</th></tr></thead><tbody>{selected.locations.map(c=><tr key={c.warehouse}><td><button className={styles.back} onClick={()=>setTerminal(c.warehouse)}>{terminalLabel(c.warehouse)}</button></td><td>{money(val(c.metrics,'warehouseRevenue'))}</td><td>{detail(c.metrics,'warehouseHandling')}</td><td>{detail(c.metrics,'warehouseStorage')}</td><td>{detail(c.metrics,'warehouseOther')}</td><td><ChassisValue metrics={c.metrics} complete={chassisComplete}/></td><td><TransportValue metrics={c.metrics} prefix="otr"/></td><td><TransportValue metrics={c.metrics} prefix="localDray"/></td><td><TransportValue metrics={c.metrics} prefix="directDray"/></td></tr>)}</tbody></table></div></section>
     <section className={styles.panel}><h2>Warehouse charge detail</h2><div className={styles.tableScroll}><table><thead><tr><th>Storage</th><th>Handling</th><th>Other warehouse fees</th><th>Invoices with detail</th></tr></thead><tbody><tr><td>{detail(metrics,'warehouseStorage')}</td><td>{detail(metrics,'warehouseHandling')}</td><td>{detail(metrics,'warehouseOther')}</td><td>{num(val(metrics,'warehouseDetailedOrders'))} / {num(val(metrics,'warehouseOrders'))}</td></tr></tbody></table></div></section>
     <section className={styles.panel}><h2>Monthly activity</h2><div className={styles.tableScroll}><table><thead><tr><th>Month</th><th>Warehouse total</th><th>Handling</th><th>Storage</th><th>Other warehouse fees</th><th>Chassis billed*</th><th>OTR revenue / order GP</th><th>Local drayage revenue / order GP</th><th>Direct drayage revenue / order GP</th></tr></thead><tbody>{selected.months.map(m=>{const mm=Object.fromEntries(Object.entries(m).filter(([k])=>k!=='month')) as BusinessMetrics;return <tr key={m.month}><td>{m.month}</td><td>{money(val(mm,'warehouseRevenue'))}</td><td>{detail(mm,'warehouseHandling')}</td><td>{detail(mm,'warehouseStorage')}</td><td>{detail(mm,'warehouseOther')}</td><td><ChassisValue metrics={mm} complete={chassisComplete}/></td><td><TransportValue metrics={mm} prefix="otr"/></td><td><TransportValue metrics={mm} prefix="localDray"/></td><td><TransportValue metrics={mm} prefix="directDray"/></td></tr>;})}</tbody></table></div></section>
    </>:<section className={styles.panel}><h2>Customer revenue and trucking performance</h2><p className={styles.hint}>{num(filtered.length)} customer relationships · Click a customer row or View customer for account codes and monthly detail.</p><div className={styles.tableScroll}><table><thead><tr><th>Customer</th><th>Business units</th><th>Warehouse total</th><th>Handling</th><th>Storage</th><th>Other warehouse fees</th><th>Chassis billed*</th><th>OTR revenue / order GP</th><th>Local drayage revenue / order GP</th><th>Direct drayage revenue / order GP</th><th>Details</th></tr></thead><tbody>{filtered.map(c=><tr key={c.code} tabIndex={0} aria-label={`Open customer ${c.name}`} onClick={()=>setSelectedCode(c.code)} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setSelectedCode(c.code);}}}><td className={styles.customer}><button style={{background:'transparent',border:0,color:'inherit',padding:0,font:'inherit',textAlign:'left',cursor:'pointer'}} onClick={()=>setSelectedCode(c.code)}>{c.name}</button><small>{c.accounts.join(' · ')}</small></td><td>{c.locations.map(x=>terminalLabel(x.warehouse)).join(' + ')}</td><td>{money(val(c.metrics,'warehouseRevenue'))}</td><td>{detail(c.metrics,'warehouseHandling')}</td><td>{detail(c.metrics,'warehouseStorage')}</td><td>{detail(c.metrics,'warehouseOther')}</td><td><ChassisValue metrics={c.metrics} complete={chassisComplete}/></td><td><TransportValue metrics={c.metrics} prefix="otr"/></td><td><TransportValue metrics={c.metrics} prefix="localDray"/></td><td><TransportValue metrics={c.metrics} prefix="directDray"/></td><td><button type="button" className={styles.back} style={{marginBottom:0,whiteSpace:'nowrap'}} aria-label={`View customer ${c.name}`} onClick={()=>setSelectedCode(c.code)}>View customer →</button></td></tr>)}</tbody></table></div></section>}
   </>}
  </>}
  <footer className={styles.foot}><Link style={{color:'#67e8f9'}} href="/reporting/business-intelligence/guide">Calculation rules, source coverage, and review notices →</Link></footer>
 </main>;
}
