import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
/** Admin-only read-only McLeod location endpoint diagnostic. Never writes to McLeod or SCM. */
export const GET = withStaffAccess(async (req: NextRequest) => {
 const base=process.env.MCLEOD_BILLING_READ_BASE_URL||process.env.MCLEOD_BASE_URL;
 const token=process.env.MCLEOD_BILLING_READ_AUTH_TOKEN||process.env.MCLEOD_AUTH_TOKEN;
 if(!base||!token) return NextResponse.json({ok:false,error:"McLeod read connection unavailable"},{status:503});
 const paths=["/locations/LOVCLUTX","/locations?location_id=LOVCLUTX","/locations/search?locations.id=LOVCLUTX&recordLength=1"];
 const results=[];
 for(const path of paths){
  try{
   const response=await fetch(base.replace(/\/$/,"")+path,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(8000)});
   const raw=await response.text();
   let parsed:unknown=null;try{parsed=JSON.parse(raw)}catch{}
   const obj=parsed&&typeof parsed==="object"?parsed as Record<string,unknown>:null;
   results.push({path:path.split("?")[0],status:response.status,
    json:!!obj,keys:obj?Object.keys(obj).slice(0,15):[],arrayLength:Array.isArray(parsed)?parsed.length:undefined});
  }catch{results.push({path:path.split("?")[0],status:"unavailable"});}
 }
 return NextResponse.json({ok:true,readOnly:true,results});
});
