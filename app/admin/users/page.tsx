"use client";
import { useEffect, useState } from "react";
import { useStaff } from "@/components/auth/StaffSession";
const supportedRole=(role:string)=>["admin","operator","warehouse1","viewer","accounting"].includes(role);
const roleLabel = (role: string) => role === "warehouse1" ? "Warehouse — Level 1" : role === "operator" ? "Warehouse — Level 2" : role;
type Member = { id: string; email: string; name: string; role: string; terminal: string | null; warehouse_level?: number | null; status: string; invite_expires_at: string };
export default function UsersPage() {
  const self = useStaff();
  const [users, setUsers] = useState<Member[]>([]); const [error, setError] = useState("");
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(""); const [name, setName] = useState("");
  const [role, setRole] = useState("operator"); const [terminal, setTerminal] = useState("HOU");
  async function load() {
    const response = await fetch("/api/admin/users", { cache: "no-store" }); const result = await response.json();
    if (!response.ok) throw new Error(result.error); setUsers(result.users.map((user: Member) => ({ ...user, role: user.role === "operator" && user.warehouse_level === 1 ? "warehouse1" : user.role })));
  }
  useEffect(()=>{ void load().catch(e=>setError(e.message)); },[]);
  async function action(body: object, message: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/users", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
      const result = await response.json(); await load();
      if (!response.ok) throw new Error(result.error);
      setNotice(message);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update users"); }
    finally { setBusy(false); }
  }
  return <main className="staff-users"><h1>Staff access</h1><p>Warehouse Level 1 manages warehouse operations and bookings, with carrier names and charge quantities visible. Level 2 also manages carriers, charges, rates, and pay. Both levels are scoped to their assigned terminal and exclude financial reports.</p>
    <form onSubmit={e=>{e.preventDefault(); void action({action:"invite",name,email,role,terminal},`Invitation sent to ${email}.`);}}>
      <label>Name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} /></label>
      <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
      <label>Role<select value={role} onChange={e=>setRole(e.target.value)}><option value="warehouse1">Warehouse — Level 1</option><option value="operator">Warehouse — Level 2</option><option value="viewer">Dispatcher / viewer</option><option value="accounting">Accounting</option><option value="admin">Administrator</option></select></label>
      {["operator", "warehouse1"].includes(role) && <label>Terminal<select value={terminal} onChange={e=>setTerminal(e.target.value)}><option value="HOU">Houston · 5300 + 4331</option><option value="SAV">Savannah · all sites</option><option value="DAL">Dallas · both sites</option></select></label>}
      <button disabled={busy}>Send invitation</button>
    </form>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div style={{overflowX:"auto"}}><table><thead><tr><th>Person</th><th>Access</th><th>Status</th><th>Actions</th></tr></thead><tbody>{users.map(user=><tr key={user.id}>
      <td>{user.name}<br/><small>{user.email}</small></td><td>{user.status === "active" && user.id !== self?.id ? <>
        <select aria-label={`Role for ${user.email}`} disabled={busy} value={user.role} onChange={e=>setUsers(current=>current.map(item=>item.id===user.id ? {...item,role:e.target.value,terminal:["operator","warehouse1"].includes(e.target.value) ? user.terminal ?? "HOU" : null} : item))}>
          {!supportedRole(user.role)&&<option value={user.role} disabled>Legacy role: {user.role} — choose supported access</option>}<option value="admin">Administrator</option><option value="warehouse1">Warehouse — Level 1</option><option value="operator">Warehouse — Level 2</option><option value="viewer">Dispatcher / viewer</option><option value="accounting">Accounting</option>
        </select>{["operator", "warehouse1"].includes(user.role) && <select aria-label={`Terminal for ${user.email}`} disabled={busy} value={user.terminal ?? "HOU"}
          onChange={e=>setUsers(current=>current.map(item=>item.id===user.id ? {...item,terminal:e.target.value} : item))}>
          <option value="HOU">Houston</option><option value="SAV">Savannah</option><option value="DAL">Dallas</option></select>}
        <button disabled={busy||!supportedRole(user.role)} onClick={()=>{if(confirm(`Save ${roleLabel(user.role)} access${user.terminal ? ` for ${user.terminal}` : ""} for ${user.email}?`)) void action({...user,action:"access"},"Permissions updated.");}}>Save access</button>
      </> : <>{roleLabel(user.role)}{user.terminal ? ` · ${user.terminal}` : " · all terminals"}</>}</td>
      <td>{user.status === "pending" && Date.parse(user.invite_expires_at) < Date.now() ? "Expired invitation" : user.status}</td>
      <td>{["pending", "disabled"].includes(user.status) && user.id !== self?.id && <button disabled={busy} onClick={()=>{
        if (user.status === "disabled" && !confirm(`Invite ${user.email} again with ${roleLabel(user.role)} access${user.terminal ? ` for ${user.terminal}` : ""}?`)) return;
        void action({action:"resend",id:user.id},"Invitation sent.");
      }}>{user.status === "disabled" ? "Reinvite" : "Resend"}</button>} {user.status !== "disabled" && user.id !== self?.id && <button disabled={busy} onClick={()=>{
        if (confirm(`${user.status === "pending" ? "Cancel the invitation for" : "Deactivate"} ${user.email}?`)) void action({action:"disable",id:user.id},"Access disabled.");
      }}>{user.status === "pending" ? "Cancel invite" : "Deactivate"}</button>}</td>
    </tr>)}</tbody></table></div>
    <p style={{marginTop:20}}>Administrator accounts can access financial modules, settings, and all terminals. Warehouse levels can update only their assigned terminal. Level 1 sees carrier names and charge quantities. Level 2 can also manage carriers, charges, rates and pay. Financial reports remain restricted to administrators. Accounting can use eCotton and dray importing and billing tools, and view warehouse operations and cotton locations across terminals, with no financial reports or user administration. Deactivation blocks subsequent staff requests.</p>
  </main>;
}
