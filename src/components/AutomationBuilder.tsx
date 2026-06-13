"use client";

import { useEffect, useState } from "react";
import {
  createAutomation, deleteAutomation, fetchAutomations, setAutomationEnabled,
  type AutomationActionInfo, type AutomationRuleInfo, type AutomationRunInfo,
} from "@/lib/api";
import { parseCql } from "@/lib/cql";

/* Automation rule builder (G-14 follow-up, admin/PM). Lists rules, toggles and
   deletes them, shows the recent run audit, and creates a rule from a trigger
   (event kind or SCHEDULE), an optional CQL condition (validated client-side),
   and an ordered action list. Actions replay through the normal command path
   server-side, so flows and gates still apply. */

const TRIGGERS = ["TRANSITION", "WI_CREATE", "WI_UPDATE", "WI_COMMENT", "FLAG_SET", "SCHEDULE"];
type ActionKind = AutomationActionInfo["kind"];
const ACTION_KINDS: ActionKind[] = ["wiComment", "itemComment", "wiMove"];

interface Props { onClose: () => void; }

type DraftAction = { kind: ActionKind; text: string; to: string };
const blankAction = (): DraftAction => ({ kind: "wiComment", text: "", to: "in_progress" });

function toWire(a: DraftAction): AutomationActionInfo | null {
  if (a.kind === "wiMove") return a.to ? { kind: "wiMove", to: a.to } : null;
  if (a.kind === "itemComment") return a.text.trim() ? { kind: "itemComment", text: a.text.trim() } : null;
  return a.text.trim() ? { kind: "wiComment", text: a.text.trim() } : null;
}

export function AutomationBuilder({ onClose }: Props) {
  const [rules, setRules] = useState<AutomationRuleInfo[]>([]);
  const [runs, setRuns] = useState<AutomationRunInfo[]>([]);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState(TRIGGERS[0]);
  const [cql, setCql] = useState("");
  const [actions, setActions] = useState<DraftAction[]>([blankAction()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    const r = await fetchAutomations();
    if (r.ok) { setRules(r.data.rules); setRuns(r.data.runs); }
    else setErr(r.error);
  }
  useEffect(() => { void reload(); }, []);

  const cqlError = cql.trim() && !parseCql(cql.trim()).ok ? "Condition doesn't parse." : null;

  async function create() {
    const wire = actions.map(toWire).filter((a): a is AutomationActionInfo => a !== null);
    if (name.trim().length < 1) { setErr("Rule needs a name."); return; }
    if (!wire.length) { setErr("Add at least one complete action."); return; }
    if (cqlError) { setErr(cqlError); return; }
    setBusy(true); setErr(null);
    const r = await createAutomation(name.trim(), trigger, cql.trim() || null, wire);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setName(""); setCql(""); setActions([blankAction()]);
    await reload();
  }

  async function toggle(id: string, enabled: boolean) {
    setBusy(true);
    const r = await setAutomationEnabled(id, enabled);
    setBusy(false);
    if (!r.ok) setErr(r.error); else await reload();
  }
  async function remove(id: string) {
    setBusy(true);
    const r = await deleteAutomation(id);
    setBusy(false);
    if (!r.ok) setErr(r.error); else await reload();
  }

  function setAction(i: number, patch: Partial<DraftAction>) {
    setActions((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  }

  return (
    <>
      <div className="wi-drawer-scrim" onClick={onClose}></div>
      <div className="admin-modal" role="dialog" aria-modal="true" aria-label="Automation rules" style={{ maxWidth: 720, width: "92vw" }}>
        <h2>Automation rules</h2>
        <p className="mono rep-sub">Trigger → condition (CQL) → actions. Actions replay through the command path, so gates &amp; flows still apply. SCHEDULE rules run on a cron tick.</p>
        {err && <div style={{ color: "var(--danger, #c00)", fontSize: 12, padding: "4px 0" }}>{err}</div>}

        <div className="wf-list" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 0", maxHeight: "22vh", overflow: "auto" }}>
          {rules.length === 0 && <div className="wi-empty">No rules yet.</div>}
          {rules.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
              <span style={{ flex: 1 }}>
                <b>{r.name}</b> <span className="mono" style={{ color: "var(--text-3)" }}>· {r.triggerKind}{r.cql ? ` · ${r.cql}` : ""} · {r.actions.length} action(s)</span>
              </span>
              <button className="act" data-on={r.enabled} disabled={busy} onClick={() => void toggle(r.id, !r.enabled)}>{r.enabled ? "On" : "Off"}</button>
              <button className="act" disabled={busy} onClick={() => void remove(r.id)}>Delete</button>
            </div>
          ))}
        </div>

        <h3 style={{ fontSize: 13, paddingTop: 8 }}>New rule</h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ flex: 1, minWidth: 160 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name" />
          <select className="wi-sel" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            {TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <label className="wi-field block"><span>Condition (CQL, optional)</span>
          <input value={cql} onChange={(e) => setCql(e.target.value)} placeholder="e.g. state = done" />
        </label>
        {cqlError && <div style={{ color: "var(--warn)", fontSize: 11 }}>{cqlError}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 4 }}>
          {actions.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
              <select className="wi-sel" value={a.kind} onChange={(e) => setAction(i, { kind: e.target.value as ActionKind })}>
                {ACTION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              {a.kind === "wiMove"
                ? <input style={{ flex: 1 }} value={a.to} onChange={(e) => setAction(i, { to: e.target.value })} placeholder="target state (e.g. in_progress)" />
                : <input style={{ flex: 1 }} value={a.text} onChange={(e) => setAction(i, { text: e.target.value })} placeholder="comment text" />}
              {actions.length > 1 && <button className="act" onClick={() => setActions((p) => p.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          <button className="act" onClick={() => setActions((p) => [...p, blankAction()])}>＋ Add action</button>
        </div>

        <div className="admin-modal-foot">
          <button className="wi-act" onClick={onClose}>Close</button>
          <button className="act primary" disabled={busy} onClick={() => void create()}>Create rule</button>
        </div>

        {runs.length > 0 && <>
          <h3 style={{ fontSize: 13, paddingTop: 10 }}>Recent runs</h3>
          <div style={{ maxHeight: "18vh", overflow: "auto", fontSize: 11 }}>
            {runs.slice(0, 20).map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "1px 0", color: r.ok ? "var(--text-2)" : "var(--danger, #c00)" }}>
                <span className="mono">{r.ok ? "✓" : "✗"}</span>
                <span style={{ flex: 1 }}>{r.detail}</span>
              </div>
            ))}
          </div>
        </>}
      </div>
    </>
  );
}
