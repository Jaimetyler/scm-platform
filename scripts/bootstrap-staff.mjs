import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
const args=process.argv.slice(2);
const value=flag=>args[args.indexOf(flag)+1];
if (!args.includes("--email") || !args.includes("--name") || !args.includes("--send-invite")) {
  console.error('Usage: node scripts/bootstrap-staff.mjs --email "you@company.com" --name "Jaime" --send-invite');
  process.exit(1);
}
const email=String(value("--email")).trim().toLowerCase(), name=String(value("--name")).trim();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!name) throw new Error("Enter your actual email and name");
const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key||!process.env.SCM_APP_URL) throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SCM_APP_URL locally first");
const origin=new URL(process.env.SCM_APP_URL).origin;
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const result=await db.rpc("scm_bootstrap_staff",{p_email:email,p_name:name});
if(result.error)throw new Error(result.error.message);
let sent=await db.auth.admin.inviteUserByEmail(email,{redirectTo:`${origin}/auth/accept`});
if(sent.error&&["email_exists","user_already_exists"].includes(sent.error.code))sent=await db.auth.resetPasswordForEmail(email,{redirectTo:`${origin}/auth/accept`});
if(sent.error)throw new Error(`Pending administrator saved, but email failed: ${sent.error.message}. Fix email settings and run this command again.`);
console.log(`Administrator invitation sent to ${email}. After deploying staff access, open the email and set your password.`);
