import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {logo,signature} from './assets.ts';
export type BolData={orderId:string;shippingOrder:string;date:string;shipper:string;mark:string;bales:number;customerOrder:string;booking:string;container:string;chassis:string;seal:string};
export function filename(r:BolData){const safe=(v:string)=>v.replace(/[^A-Za-z0-9._-]/g,'_').replace(/\.{2,}/g,'_').replace(/^\.+/,'').slice(0,80)||'unassigned';return safe(r.booking)+'/'+safe(r.mark)+'_'+safe(r.container)+'_'+safe(r.orderId)+'.pdf';}
export async function createBol(r:BolData){
 const pdf=await PDFDocument.create();pdf.setTitle(`Bill of Lading ${r.orderId} ${r.container}`);pdf.setAuthor('Supply Chain Management LLC');
 // Keep output deterministic for document receipts and duplicate detection.
 pdf.setCreationDate(new Date(r.date+'T12:00:00Z'));pdf.setModificationDate(new Date(r.date+'T12:00:00Z'));
 const page=pdf.addPage([595.28,841.89]),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const text=(value:string,x:number,top:number,size=10,strong=false,width=250)=>{
 const font=strong?bold:regular;let s=String(value).replace(/[\r\n\t]+/g,' ').trim();let measured:number;try{measured=font.widthOfTextAtSize(s,size)}catch{throw Error('Unsupported character in BOL data; review source.');}
 const fitted=measured>width?size*width/measured:size;if(fitted<7)throw Error('BOL field is too long to print clearly; review source.');
 page.drawText(s,{x,y:841.89-top-fitted,size:fitted,font,color:rgb(0,0,0)});
 };
 const center=(s:string,top:number,size:number,strong=false)=>{const f=strong?bold:regular;text(s,(595.28-f.widthOfTextAtSize(s,size))/2,top,size,strong,540)};
 const date=r.date.slice(5,7)+'/'+r.date.slice(8,10)+'/'+r.date.slice(0,4);
 const mark=await pdf.embedPng(logo);page.drawImage(mark,{x:28.35,y:841.89-42.52-27.5,width:85.04,height:27.5});
 center(r.orderId,16,10);text('Order: '+r.shippingOrder,475,48,11,true,92);
 center('Supply Chain Management - SAV',57,12,true);center('1601 Old Augusta Road South',75,12,true);center('Rincon, GA 31326',93,12,true);
 center('Bill of Lading',110,14,true);center('Date: '+date,139,12);
 const left=[['Shipper:',r.shipper],['Mark:',r.mark],['Bales:',String(r.bales)],["Shipper’s Order #:",r.customerOrder]],right=[['Booking #:',r.booking],['Container #:',r.container],['Chassis #:',r.chassis],['Seal #:',r.seal]];
 for(let i=0;i<4;i++){const y=206+i*23;text(left[i][0].replace('’',"'"),28.35,y,10,true,110);text(left[i][1],142,y,10,false,160);text(right[i][0],314,y,10,true,105);text(right[i][1],427,y,10,false,140);}
 // Place the supplied full signature artwork at its original script coordinates.
 const sign=await pdf.embedPng(signature),w=283.46,h=w*sign.height/sign.width;page.drawImage(sign,{x:28.35,y:841.89-510.24-h,width:w,height:h});
 page.drawLine({start:{x:28.35,y:841.89-609.45},end:{x:566.93,y:841.89-609.45},thickness:1.4});center('Loaded: '+date,646,12,true);
 return pdf.save({useObjectStreams:false});
}
