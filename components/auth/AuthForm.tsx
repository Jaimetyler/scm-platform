"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

export default function AuthForm({ mode }: { mode: "login" | "accept" | "password" }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState(""); const [error, setError] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState({ token_hash: "", type: "" });
  useEffect(() => { if (mode === "accept") {
    const query = new URLSearchParams(location.search);
    const token = query.get("token_hash");
    if (token) {
      setInvite({ token_hash: token, type: query.get("type") || "" });
      history.replaceState(null, "", "/auth/accept");
    }
  } }, [mode]);
  async function submit(action: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      if (action === "password" && password !== confirm) throw new Error("The passwords do not match.");
      const response = await fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email, password, ...invite }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sign in");
      if (result.next) location.assign(result.next); else setMessage(result.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sign in"); }
    finally { setBusy(false); }
  }
  return <main className="staff-card"><h1>SCM {mode === "login" ? "staff sign-in" : mode === "accept" ? "welcome" : "set your password"}</h1>
    <p>{mode === "login" ? "Use your individual staff account." : mode === "accept" ? "Continue to verify your email and set your password." : "Choose a password with at least 12 characters."}</p>
    <form onSubmit={(event) => { event.preventDefault(); void submit(mode); }}>
      {mode === "login" && <label>Email<input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} /></label>}
      {mode !== "accept" && <label>Password<input type="password" required minLength={mode === "password" ? 12 : undefined} maxLength={128}
        autoComplete={mode === "password" ? "new-password" : "current-password"} value={password} onChange={e=>setPassword(e.target.value)} /></label>}
      {mode === "password" && <label>Confirm password<input type="password" required autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} /></label>}
      <button disabled={busy || mode === "accept" && !invite.token_hash}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "accept" ? "Continue" : "Save password"}</button>
    </form>
    {mode === "login" && <button type="button" disabled={busy || !email} onClick={()=>void submit("recover")}>Email me a password reset</button>}
    {mode === "accept" && !invite.token_hash && <p>Open the link in your invitation or password reset email.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {mode !== "login" && <Link href="/login">Back to sign-in</Link>}
  </main>;
}
