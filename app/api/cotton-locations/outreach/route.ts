import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffActor, staffProfile } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { outreachUpdate } from "@/lib/cotton-locations/outreach";
import {existingTariffs,tariffsForLocation} from "@/lib/cotton-locations/existing-tariffs";
export const dynamic="force-dynamic";
export const GET=withStaffAccess(async()=>{
 const db=staffDatabase();
 const results=await Promise.all([
 db.from("cotton_tariff_outreach").select("*").order("priority",{ascending:false}).order("location_id").limit(3000),
 db.from("cotton_location_master").select("id,mcleod_code,prev_code,name,city,state,address").limit(3000),
 db.from("cotton_tariff_documents").select("id,location_id,filename,uploaded_at,uploaded_by").order("uploaded_at",{ascending:false}).limit(5000),
 db.from("cotton_location_schedules").select("location_id,verified").limit(10000),
 db.from("cotton_tariff_outreach_events").select("id,location_id,action,actor,created_at,after_value").order("created_at",{ascending:false}).limit(1000),
 db.from("cotton_location_equipment").select("*").limit(3000)
 ]);
 if(results.some(r=>r.error))return NextResponse.json({ok:false,error:"Outreach records unavailable. Try again."},{status:503});
 const [queue,locations,documents,schedules,events,equipment]=results.map(r=>r.data||[]);
 return NextResponse.json({ok:true,sourceInventory:existingTariffs,rows:queue.map(q=>({...q,equipment:equipment.find(e=>e.location_id===q.location_id)||null,existingTariffs:tariffsForLocation(locations.find(l=>l.id===q.location_id)?.mcleod_code||""),location:locations.find(l=>l.id===q.location_id),documents:documents.filter(d=>d.location_id===q.location_id),hours:schedules.some(s=>s.location_id===q.location_id)?schedules.some(s=>s.location_id===q.location_id&&s.verified)?"Confirmed hours":"Unverified hours":"No saved hours",events:events.filter(e=>e.location_id===q.location_id).slice(0,15)}))},{headers:{"Cache-Control":"private, no-store"}});
});
export const PATCH=withStaffAccess(async(req:NextRequest)=>{
 let input;try{input=await req.json()}catch{return NextResponse.json({ok:false,error:"Invalid request"},{status:400})}
 let changes;try{changes=outreachUpdate(input,staffProfile(req)?.role==="admin")}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Invalid update"},{status:400})}
 const {data,error}=await staffDatabase().rpc("save_cotton_tariff_outreach",{p_location:input.locationId,p_version:input.version,p_changes:changes,p_actor:staffActor(req),p_admin:staffProfile(req)?.role==="admin"});
 if(error)return NextResponse.json({ok:false,error:error.message},{status:409});
 return NextResponse.json({ok:true,result:data});
});
