"use client";

import { useEffect, useState } from "react";
import {
  STATES, TRANSITIONS,
  type Role, type StateKey, type TransitionDef, type TransitionKind,
} from "@/lib/engine";
import { validateWorkflow } from "@/lib/workflow";
import {
  assignWorkflowScheme, createWorkflowScheme, deleteWorkflowScheme,
  fetchWorkflowSchemes, updateWorkflowScheme,
  type ProjectInfo, type WorkflowSchemeInfo,
} from "@/lib/api";

/* Workflow editor (G-13, admin): PM-only. Lists workflow schemes, clones the
   engine default as a starting point, edits the transition table (roles, kind,
   reason rule, gate), validates against engine invariants before saving, and
   assigns a scheme to a project. STATES + GATES stay engine-defined — only the
   EDGES are editable here. A project with no scheme uses the engine default. */

const STATE_KEYS = Object.keys(STATES) as StateKey[];
const KINDS: TransitionKind[] = ["forward", "rework", "terminal", "recovery", "hotfix"];

interface Props {
  projects: ProjectInfo[];
  onClose: () => void;
  onAssigned: () => void;       // refresh structure after an assignment
}

type Draft = { id: string | null; name: string; transitions: TransitionDef[] };

const blankRow = (): TransitionDef => ({ from: "backlog", to: "in_discovery", roles: ["PM"], kind: "forward", label: "New transition" });
const cloneDefault = (): Draft => ({ id: null, name: "", transitions: TRANSITIONS.map((t) => ({ ...t, roles: [...t.roles] })) });

export function WorkflowEditor({ projects, onClose, onAssigned }: Props) {
  const [schemes, setSchemes] = useState<WorkflowSchemeInfo[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    const r = await fetchWorkflowSchemes();
    if (r.ok) setSchemes(r.data.schemes);
  }
  useEffect(() => { void reload(); }, []);

  const validation = draft ? validateWorkflow(draft.transitions) : null;
  const valid = !validation || validation.ok;

  function editRow(i: number, patch: Partial<TransitionDef>) {
    if (!draft) return;
    setDraft({ ...draft, transitions: draft.transitions.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  }
  function toggleRole(i: number, role: Role) {
    if (!draft) return;
    const cur = draft.transitions[i].roles;
    const next = cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role];
    editRow(i, { roles: next });
  }

  async function save() {
    if (!draft) return;
    const v = validateWorkflow(draft.transitions);
    if (!v.ok) { setErr(v.errors.join(" ")); return; }
    if (draft.name.trim().length < 2) { setErr("Scheme needs a name (2+ chars)."); return; }
    setBusy(true); setErr(null);
    const r = draft.id
      ? await updateWorkflowScheme(draft.id, draft.name.trim(), draft.transitions)
      : await createWorkflowScheme(draft.name.trim(), draft.transitions);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setDraft(null);
    await reload();
  }

  async function remove(id: string) {
    setBusy(true);
    const r = await deleteWorkflowScheme(id);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    if (draft?.id === id) setDraft(null);
    await reload();
    onAssigned(); // projects may have reverted to default
  }

  async function assign(projectId: string, schemeId: string | null) {
    setBusy(true);
    const r = await assignWorkflowScheme(projectId, schemeId);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onAssigned();
  }

  return (
    <>
      <div className="wi-drawer-scrim" onClick={onClose}></div>
      <div className="admin-modal wf-editor" role="dialog" aria-modal="true" aria-label="Workflow schemes" style={{ maxWidth: 880, width: "92vw" }}>
        <h2>Workflow schemes</h2>
        <p className="mono rep-sub">Per-project transition tables. States &amp; gates stay engine-defined — only the moves between states are editable. Projects with no scheme use the Cadence default.</p>

        {err && <div className="wf-err" style={{ color: "var(--danger, #c00)", fontSize: 12, padding: "4px 0" }}>{err}</div>}

        {!draft && <>
          <div className="wf-list" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 0" }}>
            {schemes.length === 0 && <div className="wi-empty">No custom schemes yet — clone the default to start.</div>}
            {schemes.map((s) => (
              <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <span style={{ flex: 1 }}>{s.name} <span className="mono" style={{ color: "var(--text-3)" }}>· {s.transitions.length} transitions</span></span>
                <button className="act" onClick={() => setDraft({ id: s.id, name: s.name, transitions: s.transitions.map((t) => ({ ...t, roles: [...t.roles] })) })}>Edit</button>
                <button className="act" disabled={busy} onClick={() => void remove(s.id)}>Delete</button>
              </div>
            ))}
          </div>
          <button className="act primary" onClick={() => setDraft(cloneDefault())}>＋ New scheme (clone default)</button>

          <div className="wf-assign" style={{ paddingTop: 16 }}>
            <h3 style={{ fontSize: 13 }}>Project assignment</h3>
            {projects.map((p) => (
              <label key={p.id} className="wi-field" style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0" }}>
                <span style={{ flex: 1, fontSize: 12 }}>{p.key} · {p.name}</span>
                <select value={p.workflowSchemeId ?? ""} disabled={busy}
                  onChange={(e) => void assign(p.id, e.target.value || null)}>
                  <option value="">Cadence default</option>
                  {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="admin-modal-foot"><button className="wi-act" onClick={onClose}>Close</button></div>
        </>}

        {draft && <>
          <label className="wi-field block"><span>Scheme name</span>
            <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Simple Kanban" />
          </label>
          {!valid && validation && !validation.ok &&
            <div className="wf-err" style={{ color: "var(--warn)", fontSize: 11, padding: "4px 0" }}>{validation.errors.join(" ")}</div>}
          <div className="wf-rows" style={{ maxHeight: "46vh", overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {draft.transitions.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11, borderBottom: "1px solid var(--border-1)", padding: "2px 0" }}>
                <select value={t.from} onChange={(e) => editRow(i, { from: e.target.value as StateKey })}>
                  {STATE_KEYS.map((s) => <option key={s} value={s}>{STATES[s].label}</option>)}
                </select>
                <span>→</span>
                <select value={t.to} onChange={(e) => editRow(i, { to: e.target.value as StateKey })}>
                  {STATE_KEYS.map((s) => <option key={s} value={s}>{STATES[s].label}</option>)}
                </select>
                <select value={t.kind} onChange={(e) => editRow(i, { kind: e.target.value as TransitionKind })}>
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <button className="act" data-on={t.roles.includes("PM")} onClick={() => toggleRole(i, "PM")}>PM</button>
                <button className="act" data-on={t.roles.includes("Dev")} onClick={() => toggleRole(i, "Dev")}>Dev</button>
                <select value={t.gate ?? ""} onChange={(e) => editRow(i, { gate: (e.target.value || undefined) as TransitionDef["gate"] })} title="gate">
                  <option value="">no gate</option>
                  <option value="ready_for_dev">ready_for_dev</option>
                  <option value="release">release</option>
                </select>
                <select value={t.needsReason ?? ""} onChange={(e) => editRow(i, { needsReason: (e.target.value || undefined) as TransitionDef["needsReason"] })} title="reason">
                  <option value="">no reason</option>
                  <option value="reject">reject</option>
                  <option value="free">free</option>
                </select>
                <input style={{ width: 110 }} value={t.label} onChange={(e) => editRow(i, { label: e.target.value })} placeholder="label" />
                <button className="act" title="remove" onClick={() => setDraft({ ...draft, transitions: draft.transitions.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
          </div>
          <button className="act" onClick={() => setDraft({ ...draft, transitions: [...draft.transitions, blankRow()] })}>＋ Add transition</button>
          <div className="admin-modal-foot">
            <button className="wi-act" onClick={() => { setDraft(null); setErr(null); }}>Cancel</button>
            <button className="act primary" disabled={busy || !valid} onClick={() => void save()}>{draft.id ? "Save" : "Create"} scheme</button>
          </div>
        </>}
      </div>
    </>
  );
}
