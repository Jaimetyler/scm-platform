import {NextRequest,NextResponse} from "next/server";
import {withStaffAccess} from "@/lib/auth/guard";
import {staffDatabase} from "@/lib/auth/session";
import {parseDispatch,buildPreview} from "@/lib/bunge/preview";
import {availableBlnumMatches} from "@/lib/bunge/duplicates";
import {vendor} from "@/lib/dray/server";
import {SCM_DELIVERY_LOCATIONS,deliveryCode} from "@/lib/bunge/destinations";
import {readDeliveryLocation} from "@/lib/bunge/delivery-server";
export const dynamic="force-dynamic";
export const maxDuration=120;
export const GET=withStaffAccess(async()=>{
 const results=await Promise.allSettled(SCM_DELIVERY_LOCATIONS.map(l=>readDeliveryLocation(l.code)));
 const locations=results.flatMap(r=>r.status==="fulfilled"?[r.value]:[]);
 const unavailable=SCM_DELIVERY_LOCATIONS.filter((_,i)=>results[i].status==="rejected").map(l=>l.code);
 if(!locations.length)return NextResponse.json({ok:false,error:"SCM delivery locations could not be verified. Retry the location list."},{status:503});
 return NextResponse.json({ok:true,locations,unavailable},{headers:{"Cache-Control":"private, no-store"}});
});
export const POST=withStaffAccess(async(req:NextRequest)=>{
 try{
 if(req.headers.get("content-type")?.includes("application/json")){
 const body=await req.json();if(body.action!=="duplicates")return NextResponse.json({ok:false,error:"Preview only; order creation is unavailable."},{status:400});
 const matches=await availableBlnumMatches(vendor(true).read,body.blnum);return NextResponse.json({ok:true,matches,scope:"Available BUNGOMNE orders with exact BLNUM only; not approval to create."});
 }
 if(Number(req.headers.get("content-length")||0)>3*1024*1024+65536)throw Error("Maximum workbook size is 3 MB.");
 const form=await req.formData(),file=form.get("file");if(!(file instanceof File)||!file.size||file.size>3*1024*1024||! /\.(xlsx|xls|csv)$/i.test(file.name))throw Error("Upload a Bunge dispatch XLSX, XLS or CSV up to 3 MB.");
 const destination=deliveryCode(form.get("destination"));
 const parsed=parseDispatch(new Uint8Array(await file.arrayBuffer()));const requested=form.get("revenue")||"auto";
 if(!["auto","MAIN","DAVIS"].includes(String(requested)))throw Error("Choose MAIN or DAVIS.");
 const revenue=requested==="auto"?(parsed.destinations.some(d=>/DALLAS|DESOTO/i.test(d))?"DAVIS":"MAIN"):requested as "MAIN"|"DAVIS";
 const db=staffDatabase();const [locations,schedules,delivery]=await Promise.all([
 db.from("cotton_location_master").select("id,mcleod_code,prev_code,name,address,city,state,timezone").limit(3000),
 db.from("cotton_location_schedules").select("location_id,weekday,open_time,close_time,checkin_cutoff,verified,appointment_required,effective_from,effective_to,created_at,source_reference").limit(10000),readDeliveryLocation(destination)]);
 if(locations.error||schedules.error)throw Error("Location schedules unavailable. Please retry.");
 return NextResponse.json({ok:true,filename:file.name,sourceRows:parsed.lines.length,excluded:parsed.excluded,sourceDestinations:parsed.destinations,revenue,delivery,proposals:buildPreview(parsed.lines,locations.data||[],schedules.data||[],revenue,destination),previewOnly:true},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Preview failed"},{status:400})}
});
