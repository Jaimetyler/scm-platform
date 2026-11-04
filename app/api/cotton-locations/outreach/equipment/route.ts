import {NextRequest,NextResponse} from "next/server";
import {withStaffAccess,staffActor,staffProfile} from "@/lib/auth/guard";
import {staffDatabase} from "@/lib/auth/session";
import {uuid} from "@/lib/cotton-locations/outreach";
import {validateEquipment} from "@/lib/cotton-locations/equipment";
export const dynamic="force-dynamic";
export const GET=withStaffAccess(async(req:NextRequest)=>{
 const id=new URL(req.url).searchParams.get("locationId");if(!uuid(id))return NextResponse.json({ok:false,error:"Invalid location"},{status:400});
 const db=staffDatabase();const [location,policy]=await Promise.all([db.from("cotton_location_master").select("id").eq("id",id).maybeSingle(),db.from("cotton_location_equipment").select("*").eq("location_id",id).maybeSingle()]);
 if(location.error||policy.error)return NextResponse.json({ok:false,error:"Equipment policy unavailable"},{status:503});if(!location.data)return NextResponse.json({ok:false,error:"Location not found"},{status:404});
 return NextResponse.json({ok:true,policy:policy.data||{location_id:id,accepted_equipment:"unknown",fee_basis:"unknown",fee_amount:null,fee_payer:"shipper",conditions:"",source_reference:"",effective_date:null,verified:false,version:0}},{headers:{"Cache-Control":"private, no-store"}});
});
export const PATCH=withStaffAccess(async(req:NextRequest)=>{
 let input;try{input=await req.json()}catch{return NextResponse.json({ok:false,error:"Invalid request"},{status:400})}
 if(!uuid(input?.location_id)||!Number.isInteger(input.version)||input.version<0)return NextResponse.json({ok:false,error:"Refresh this location before saving."},{status:400});
 const admin=staffProfile(req)?.role==="admin";let changes;try{changes=validateEquipment(input,admin)}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Invalid policy"},{status:400})}
 const {data,error}=await staffDatabase().rpc("save_cotton_equipment",{p_location:input.location_id,p_version:input.version,p_changes:changes,p_actor:staffActor(req),p_admin:admin});
 if(error)return NextResponse.json({ok:false,error:error.message},{status:409});return NextResponse.json({ok:true,policy:data});
});
