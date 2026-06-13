"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const SSO_REASONS: Record<string, string> = {
  state: "Sign-in session expired — please try again.",
  noemail: "Your identity provider didn't share a verified email.",
  nouser: "No Cadence account matches that email. Ask an admin to add you.",
  disabled: "SSO is not configured on this server.",
  error: "SSO sign-in failed — please try again.",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/auth/sso/status").then((r) => r.json()).then((b) => {
      if (b?.success) setSsoEnabled(!!b.data.enabled);
    }).catch(() => { /* SSO simply stays hidden */ });
    const reason = new URLSearchParams(window.location.search).get("sso");
    if (reason && SSO_REASONS[reason]) setError(SSO_REASONS[reason]);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error || "Login failed.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand"><span className="glyph">C</span><span>Cadence</span></div>
        <h1>Sign in</h1>
        <label className="wi-field block"><span>Email</span>
          <input type="email" autoComplete="username" required autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.dev" />
        </label>
        <label className="wi-field block"><span>Password</span>
          <input type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </label>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button className="act primary login-btn" type="submit" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {ssoEnabled &&
          <>
            <div className="login-or mono" style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", padding: "8px 0" }}>or</div>
            <button type="button" className="act login-btn" style={{ width: "100%" }}
              onClick={() => { window.location.href = "/api/auth/sso/login"; }}>
              Sign in with SSO
            </button>
          </>}
      </form>
    </div>
  );
}
