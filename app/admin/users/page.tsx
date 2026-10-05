"use client";
import { useEffect, useState } from "react";
import { useStaff } from "@/components/auth/StaffSession";
type Member = { id: string; email: string; name: string; role: string; terminal: string | null; status: string; invite_expires_at: string };
export default function UsersPage() {
  const self = useStaff();
  const [users, setUsers] = useState<Member[]>([]); const [error, setError] = useState("");
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(""); const [name, setName] = useState("");
  const [role, setRole] = useState("operator"); const [terminal, setTerminal] = useState("HOU");
  async function load() {
    const response = await fetch("/api/admin/users", { cache: "no-store" }); const result = await response.json();
    if (!response.ok) throw new Error(result.error); setUsers(result.users);
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
  return <main className="staff-users"><h1>Staff access</h1><p>Invite Houston operators for both 5300 and 4331. Viewers can search and read warehouse information across terminals.</p>
    <form onSubmit={e=>{e.preventDefault(); void action({action:"invite",name,email,role,terminal},`Invitation sent to ${email}.`);}}>
      <label>Name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} /></label>
      <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
      <label>Role<select value={role} onChange={e=>setRole(e.target.value)}><option value="operator">Warehouse operator</option><option value="viewer">Dispatcher / viewer</option><option value="admin">Administrator</option></select></label>
      {role === "operator" && <label>Terminal<select value={terminal} onChange={e=>setTerminal(e.target.value)}><option value="HOU">Houston · 5300 + 4331</option><option value="SAV">Savannah · all sites</option></select></label>}
      <button disabled={busy}>Send invitation</button>
    </form>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div style={{overflowX:"auto"}}><table><thead><tr><th>Person</th><th>Access</th><th>Status</th><th>Actions</th></tr></thead><tbody>{users.map(user=><tr key={user.id}>
      <td>{user.name}<br/><small>{user.email}</small></td><td>{user.status === "active" && user.id !== self?.id ? <>
        <select aria-label={`Role for ${user.email}`} disabled={busy} value={user.role} onChange={e=>setUsers(current=>current.map(item=>item.id===user.id ? {...item,role:e.target.value,terminal:e.target.value==="operator" ? "HOU" : null} : item))}>
          <option value="admin">Administrator</option><option value="operator">Warehouse operator</option><option value="viewer">Dispatcher / viewer</option>
        </select>{user.role === "operator" && <select aria-label={`Terminal for ${user.email}`} disabled={busy} value={user.terminal ?? "HOU"}
          onChange={e=>setUsers(current=>current.map(item=>item.id===user.id ? {...item,terminal:e.target.value} : item))}>
          <option value="HOU">Houston</option><option value="SAV">Savannah</option></select>}
        <button disabled={busy} onClick={()=>{if(confirm(`Save ${user.role} access${user.terminal ? ` for ${user.terminal}` : ""} for ${user.email}?`)) void action({...user,action:"access"},"Permissions updated.");}}>Save access</button>
      </> : <>{user.role}{user.terminal ? ` · ${user.terminal}` : " · all terminals"}</>}</td>
      <td>{user.status === "pending" && Date.parse(user.invite_expires_at) < Date.now() ? "Expired invitation" : user.status}</td>
      <td>{user.status === "pending" && <button disabled={busy} onClick={()=>void action({action:"resend",id:user.id},"Invitation resent.")}>Resend</button>} {user.status !== "disabled" && user.id !== self?.id && <button disabled={busy} onClick={()=>{
        if (confirm(`${user.status === "pending" ? "Cancel the invitation for" : "Deactivate"} ${user.email}?`)) void action({action:"disable",id:user.id},"Access disabled.");
      }}>{user.status === "pending" ? "Cancel invite" : "Deactivate"}</button>}</td>
    </tr>)}</tbody></table></div>
    <p style={{marginTop:20}}>Administrator accounts can access financial modules, settings, and all terminals. Operators can update only their assigned terminal. Deactivation blocks subsequent staff requests.</p>
  </main>;
}
