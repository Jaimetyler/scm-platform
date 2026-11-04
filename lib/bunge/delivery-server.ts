import {deliveryCode,type DeliveryLocation} from "./destinations";
export async function readDeliveryLocation(code:string):Promise<DeliveryLocation>{
 deliveryCode(code);
 const base=process.env.MCLEOD_BILLING_READ_BASE_URL||process.env.MCLEOD_BASE_URL;
 const token=process.env.MCLEOD_BILLING_READ_AUTH_TOKEN||process.env.MCLEOD_AUTH_TOKEN;
 if(!base||!token)throw Error("McLeod location lookup unavailable.");
 const res=await fetch(base.replace(/\/$/,"")+"/locations/"+encodeURIComponent(code),{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error("Unable to verify selected delivery location in McLeod.");
 const row=await res.json();if(row?.id!==code||row.company_id!=="TMS"||[false,"N"].includes(row.is_active))throw Error("Selected delivery location is unavailable or inactive.");
 return {code,name:row.name||code,address:row.address1||"",address2:row.address2||"",city:row.city_name||"",state:row.state||"",zip:row.zip_code||""};
}
