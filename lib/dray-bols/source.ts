import Papa from 'papaparse';
import {normalize} from '../dray/model.ts';
export function bolBales(csv:string){
 if(typeof csv!=='string'||Buffer.byteLength(csv)>2_000_000)throw Error('Dray report exceeds 2 MB.');
 const parsed=Papa.parse<string[]>(csv,{skipEmptyLines:'greedy'});if(parsed.errors.length)throw Error('Dray CSV could not be read.');
 const h=(v:unknown)=>normalize(v).replace(/[^A-Z0-9]/g,''),required=['SHIPPINGORDER','EQUIPMENTTRACKING','TOTALBALES','PICKUPPOINT','SSLINE'];
 const index=parsed.data.findIndex(r=>required.every(n=>r.map(h).includes(n)));if(index<0)throw Error('Current dray report headers, including Pickup Point, are required.');
 const names=parsed.data[index].map(h);if(required.some(n=>names.filter(x=>x===n).length!==1))throw Error('Duplicate dray headers.');
 const details:{sourceKey:string;bales:number}[]=[];const seen=new Set<string>();
 for(const row of parsed.data.slice(index+1)){
 const get=(n:string)=>String(row[names.indexOf(n)]??'').trim();
 if(!get('PICKUPPOINT')||!get('SSLINE')||h(get('SSLINE'))==='NOBILL')continue;
 const container=normalize(get('EQUIPMENTTRACKING')).replace(/[\s-]/g,''),shipping=get('SHIPPINGORDER');
 const bales=Number(get('TOTALBALES').replaceAll(',',''));if(!shipping||!Number.isInteger(bales)||bales<1||bales>1000||!/^[A-Z]{4}\d{7}$/.test(container))continue;
 const sourceKey=shipping+':'+container;if(seen.has(sourceKey))throw Error('Duplicate BOL source row.');seen.add(sourceKey);details.push({sourceKey,bales});
 }
 return details;
}
