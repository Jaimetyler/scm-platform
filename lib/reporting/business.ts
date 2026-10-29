export type BusinessMetrics=Record<string,number>;
export const BUSINESS_TRANSPORT=[
 {prefix:'otr',label:'OTR trucking'},
 {prefix:'localDray',label:'Local drayage'},
 {prefix:'directDray',label:'Direct drayage'},
] as const;
export function businessRevenue(m:BusinessMetrics){return (m.warehouseRevenue||0)+(m.otrRevenue||0)+(m.drayRevenue||0);}
export function businessTransport(m:BusinessMetrics){return BUSINESS_TRANSPORT.map(({prefix,label})=>{
 const known=Object.hasOwn(m,prefix+'Pay'),missing=m[prefix+'PayMissing']||0;
 return {prefix,label,orders:m[prefix+'Orders']||0,revenue:m[prefix+'Revenue']||0,
  coveredRevenue:m[prefix+'RevenueWithPay']||0,pay:!known&&missing?null:m[prefix+'Pay']||0,gp:!known&&missing?null:(m[prefix+'RevenueWithPay']||0)-(m[prefix+'Pay']||0),missing};
});}
export function businessPeriodRows<T extends {metrics:BusinessMetrics;months:({month:string;[key:string]:string|number})[]}>(rows:T[],from:string,to:string):T[]{
 return rows.flatMap(row=>{
  const months=row.months.filter(m=>m.month>=from&&m.month<=to);
  if(!months.length)return [];
  const metrics:BusinessMetrics={};
  for(const m of months)for(const [key,value] of Object.entries(m))if(key!=='month'&&typeof value==='number')metrics[key]=(metrics[key]||0)+value;
  return [{...row,months,metrics}];
 });
}
