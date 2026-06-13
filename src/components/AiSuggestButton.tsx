"use client";

import { useState } from "react";
import { aiSuggest, type AiSuggestPayload } from "@/lib/api";

/* Advisory AI suggestion button (G-27). Calls the server, which is gated behind
   ANTHROPIC_API_KEY — a 404 renders as a friendly "not configured" note. The
   result is shown inline and never auto-applied: the user reads it and acts
   through the normal command path. */
export function AiSuggestButton({ label, payload }: { label: string; payload: AiSuggestPayload }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true); setText(null); setNote(null);
    const r = await aiSuggest(payload);
    setBusy(false);
    if (r.ok) setText(r.data.text);
    else setNote(r.status === 404 ? "AI suggestions aren’t configured on this server." : r.error);
  }

  return (
    <div className="ai-suggest" style={{ paddingTop: 6 }}>
      <button className="act" disabled={busy} onClick={() => void run()}>
        ✨ {busy ? "Thinking…" : label}
      </button>
      {note && <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", paddingTop: 4 }}>{note}</div>}
      {text && (
        <div className="ai-suggest-out" style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 6, padding: 8, border: "1px solid var(--border-1)", borderRadius: 6, background: "var(--bg-1, transparent)" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", paddingBottom: 4 }}>AI suggestion · review before acting</div>
          {text}
        </div>
      )}
    </div>
  );
}
