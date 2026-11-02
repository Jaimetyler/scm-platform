import {NextRequest,NextResponse} from "next/server";
import {withStaffAccess,staffActor} from "@/lib/auth/guard";
import {staffDatabase} from "@/lib/auth/session";
export const dynamic="force-dynamic";
const feeTypes=["NONE","FLAT","PER_DAY","PER_BALE_ONE_TIME","PER_BALE_PER_DAY","NOT_ALLOWED","CUSTOM"];
export const POST=withStaffAccess(async(req:NextRequest)=>{
 let input:any;
 try{input=await req.json()}catch{return NextResponse.json({ok:false,error:"Invalid JSON"},{status:400})}
 const id=input?.locationId;
 if(typeof id!=="string"||!/^[a-f0-9-]{36}$/i.test(id))return NextResponse.json({ok:false,error:"Invalid location"},{status:400});
 const kind=input?.kind;
 if(kind!=="hours"&&kind!=="fees")return NextResponse.json({ok:false,error:"Invalid update type"},{status:400});
 const db=staffDatabase();
 const {data:location,error:locError}=await db.from("cotton_location_master").select("id").eq("id",id).maybeSingle();
 if(locError||!location)return NextResponse.json({ok:false,error:"Location not found"},{status:404});
 const actor=staffActor(req);
 if(kind==="hours"){
  const days=input.days;
  if(!Array.isArray(days)||!days.length||days.length>7||new Set(days).size!==days.length||days.some((d:unknown)=>!Number.isInteger(d)||Number(d)<0||Number(d)>6))
   return NextResponse.json({ok:false,error:"Choose valid weekdays"},{status:400});
  const time=(v:unknown)=>typeof v==="string"&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
  const open=input.openTime,close=input.closeTime,cutoff=input.cutoffTime;
  if((open!=null&&!time(open))||(close!=null&&!time(close))||(cutoff!=null&&!time(cutoff))||(open&&close&&open>=close))
   return NextResponse.json({ok:false,error:"Invalid pickup hours"},{status:400});
  if(typeof input.appointmentRequired!=="boolean"||typeof input.verified!=="boolean"||typeof input.source!=="string"||!input.source.trim())
   return NextResponse.json({ok:false,error:"Appointment, verification and source are required"},{status:400});
  if(!input.appointmentRequired&&(!open||!close))return NextResponse.json({ok:false,error:"Pickup window required for non-appointment location"},{status:400});
  const {data,error}=await db.rpc("save_cotton_schedule_review",{p_location_id:id,p_days:days,p_open:open||null,p_close:close||null,p_cutoff:cutoff||null,p_appointment:input.appointmentRequired,p_verified:input.verified,p_source:input.source.trim(),p_actor:actor});
  if(error)return NextResponse.json({ok:false,error:error.message},{status:409});
  return NextResponse.json({ok:true,result:data});
 }
 const rules=input.rules;
 if(!Array.isArray(rules)||rules.length!==2||!["late_pickup","early_pickup"].every(k=>rules.some((r:any)=>r?.rule_kind===k)))
  return NextResponse.json({ok:false,error:"Both late and early rules are required"},{status:400});
 for(const rule of rules){
  if(!feeTypes.includes(rule.fee_type)||typeof rule.amount!=="number"||!Number.isFinite(rule.amount)||rule.amount<0||rule.amount>100000||!Number.isInteger(rule.grace_days??0)||Number(rule.grace_days??0)<0)
   return NextResponse.json({ok:false,error:"Invalid fee rule"},{status:400});
 }
 if(typeof input.source!=="string"||!input.source.trim()||typeof input.effectiveFrom!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom))
  return NextResponse.json({ok:false,error:"Source and effective date required"},{status:400});
 const {data,error}=await db.rpc("save_cotton_fee_draft",{p_location_id:id,p_rules:rules,p_effective_from:input.effectiveFrom,p_source:input.source.trim(),p_actor:actor});
 if(error)return NextResponse.json({ok:false,error:error.message},{status:409});
 return NextResponse.json({ok:true,result:data});
});
