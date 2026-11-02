import {NextRequest,NextResponse} from "next/server";
import {withStaffAccess} from "@/lib/auth/guard";
import {staffDatabase} from "@/lib/auth/session";
export const dynamic="force-dynamic";
export const GET=withStaffAccess(async(req:NextRequest)=>{
 const id=new URL(req.url).searchParams.get("location_id");
 if(!id||!/^[a-f0-9-]{36}$/i.test(id))return NextResponse.json({ok:false,error:"Invalid location ID"},{status:400});
 const db=staffDatabase();
 const [location,versions,schedules]=await Promise.all([
  db.from("cotton_location_master").select("id,mcleod_code,name").eq("id",id).maybeSingle(),
  db.from("cotton_location_policy_versions").select("id,status,effective_from,effective_to,source_type,source_reference,notes,created_at").eq("location_id",id).order("created_at",{ascending:false}),
  db.from("cotton_location_schedules").select("id,weekday,open_time,close_time,checkin_cutoff,appointment_required,verified,source_reference,notes,effective_from,effective_to").eq("location_id",id)
 ]);
 if(location.error||!location.data)return NextResponse.json({ok:false,error:"Location unavailable"},{status:404});
 if(versions.error||schedules.error)return NextResponse.json({ok:false,error:"Policies unavailable"},{status:503});
 const ids=(versions.data||[]).map(v=>v.id);
 const rules=ids.length?await db.from("cotton_location_policy_rules").select("policy_version_id,rule_kind,fee_type,amount,grace_days,grace_unit,avoidable_fee,conditions,notes").in("policy_version_id",ids):{data:[],error:null};
 if(rules.error)return NextResponse.json({ok:false,error:"Fee rules unavailable"},{status:503});
 return NextResponse.json({ok:true,location:location.data,versions:(versions.data||[]).map(v=>({...v,rules:(rules.data||[]).filter(r=>r.policy_version_id===v.id)})),schedules:schedules.data||[],readOnly:true});
});
