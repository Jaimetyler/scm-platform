import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffActor } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
const editable = ["name","address","city","state","timezone","prev_code","active"] as const;
async function handler(req: NextRequest) {
 const db=staffDatabase();
 if(req.method==="GET") {
  const {data,error}=await db.from("cotton_location_master")
   .select("id,mcleod_code,prev_code,name,address,city,state,timezone,active,updated_at")
   .order("mcleod_code").limit(3000);
  if(error) return NextResponse.json({ok:false,error:"Location records unavailable"},{status:503});
  return NextResponse.json({ok:true,locations:data||[]});
 }
 const body=await req.json();
 if(!body || typeof body!=="object" || Array.isArray(body) || typeof body.id!=="string")
  return NextResponse.json({ok:false,error:"Invalid update request"},{status:400});
 const changes:Record<string,unknown>={};
 for(const field of editable) if(Object.hasOwn(body,field)) {
  const value=body[field];
  if(field==="active") {
   if(typeof value!=="boolean") return NextResponse.json({ok:false,error:"Invalid active flag"},{status:400});
  } else if(value!==null && (typeof value!=="string" || value.length>250))
   return NextResponse.json({ok:false,error:`Invalid ${field}`},{status:400});
  changes[field]=typeof value==="string"?value.trim():value;
 }
 if(!Object.keys(changes).length) return NextResponse.json({ok:false,error:"No changes supplied"},{status:400});
 const {data:before,error:readError}=await db.from("cotton_location_master").select("*").eq("id",body.id).maybeSingle();
 if(readError||!before) return NextResponse.json({ok:false,error:"Location not found"},{status:404});
 if(typeof body.expectedUpdatedAt!=="string"||body.expectedUpdatedAt!==before.updated_at)
  return NextResponse.json({ok:false,error:"Location was modified. Refresh before saving."},{status:409});
 const {data:after,error:updateError}=await db.rpc("update_cotton_location_audited",{
  p_id:body.id,p_expected_updated_at:body.expectedUpdatedAt,p_changes:changes,p_actor:staffActor(req)
 });
 if(updateError||!after) return NextResponse.json({ok:false,error:updateError?.message||"Location update failed"},{status:409});
 return NextResponse.json({ok:true,location:after});
}
export const GET=withStaffAccess(handler);
export const PATCH=withStaffAccess(handler);
