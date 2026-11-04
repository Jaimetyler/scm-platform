import { NextRequest,NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {withStaffAccess,staffActor} from "@/lib/auth/guard";
import {staffDatabase} from "@/lib/auth/session";
import {uuid,tariffBucket,tariffType,maxTariffBytes} from "@/lib/cotton-locations/outreach";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const POST=withStaffAccess(async(req:NextRequest)=>{
 if(Number(req.headers.get("content-length")||0)>maxTariffBytes+65536)return NextResponse.json({ok:false,error:"Maximum file size is 3 MB."},{status:413});
 let form;try{form=await req.formData()}catch{return NextResponse.json({ok:false,error:"Invalid upload"},{status:400})}
 const location=form.get("locationId"),file=form.get("file");
 if(!uuid(location)||!(file instanceof File)||!file.size||file.size>maxTariffBytes)return NextResponse.json({ok:false,error:"Choose a PDF, JPEG or PNG up to 3 MB."},{status:400});
 const bytes=new Uint8Array(await file.arrayBuffer()),detected=tariffType(bytes);
 if(!detected)return NextResponse.json({ok:false,error:"Upload a PDF, JPEG or PNG document."},{status:400});
 const db=staffDatabase();
 const {data:row,error:readError}=await db.from("cotton_tariff_outreach").select("location_id").eq("location_id",location).maybeSingle();
 if(readError||!row)return NextResponse.json({ok:false,error:"Facility not found"},{status:404});
 const id=randomUUID(),path=`${location}/${id}.${detected.extension}`;
 const {error:uploadError}=await db.storage.from(tariffBucket).upload(path,bytes,{contentType:detected.type,upsert:false});
 if(uploadError)return NextResponse.json({ok:false,error:"Document upload failed. Try again."},{status:503});
 const {error}=await db.rpc("record_cotton_tariff_document",{p_id:id,p_location:location,p_path:path,p_filename:file.name.replace(/[\x00-\x1f\x7f]/g,"").slice(0,250)||`tariff.${detected.extension}`,p_actor:staffActor(req)});
 if(error){await db.storage.from(tariffBucket).remove([path]);return NextResponse.json({ok:false,error:"Document record could not be saved. Please retry."},{status:503})}
 return NextResponse.json({ok:true});
});
export const GET=withStaffAccess(async(req:NextRequest)=>{
 const id=new URL(req.url).searchParams.get("id");if(!uuid(id))return NextResponse.json({ok:false,error:"Invalid document"},{status:400});
 const db=staffDatabase();const {data,error}=await db.from("cotton_tariff_documents").select("path").eq("id",id).maybeSingle();
 if(error||!data)return NextResponse.json({ok:false,error:"Document unavailable"},{status:404});
 const signed=await db.storage.from(tariffBucket).createSignedUrl(data.path,60,{download:true});
 if(signed.error||!signed.data)return NextResponse.json({ok:false,error:"Document unavailable"},{status:503});
 const res=NextResponse.redirect(signed.data.signedUrl,302);res.headers.set("Cache-Control","private, no-store");return res;
});
