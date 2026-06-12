"use client";

import { useState } from "react";

export function IntakeForm({ token }: { token: string }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requester, setRequester] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(requester.trim() ? { requester: requester.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setError(body.error || "Submission failed.");
        setState("error");
        return;
      }
      setState("sent");
    } catch {
      setError("Network error.");
      setState("error");
    }
  }

  if (state === "sent")
    return (
      <main style={{ maxWidth: 520, margin: "80px auto", padding: 24 }}>
        <div className="card"><div className="card-b">
          <h2>Thanks — request received.</h2>
          <p style={{ color: "var(--text-3)" }}>The team will pick it up from their intake queue.</p>
          <button className="act" onClick={() => { setTitle(""); setDescription(""); setState("idle"); }}>Submit another</button>
        </div></div>
      </main>
    );

  return (
    <main style={{ maxWidth: 520, margin: "80px auto", padding: 24 }}>
      <div className="card">
        <div className="card-h"><h3>Submit a request</h3></div>
        <div className="card-b">
          <form onSubmit={(e) => void submit(e)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span>Title *</span>
              <input value={title} required maxLength={300} placeholder="What do you need?"
                onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span>Details</span>
              <textarea value={description} rows={5} maxLength={5000} placeholder="Context, links, expectations…"
                onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span>Your name</span>
              <input value={requester} maxLength={120} placeholder="So the team can follow up"
                onChange={(e) => setRequester(e.target.value)} />
            </label>
            {state === "error" && <div className="mono" style={{ color: "var(--danger, #c33)", fontSize: 11 }}>⚠ {error}</div>}
            <button className="act" type="submit" disabled={!title.trim() || state === "busy"}>
              {state === "busy" ? "Sending…" : "Send request"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
