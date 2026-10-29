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
