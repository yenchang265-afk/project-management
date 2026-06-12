"use client";

import { useEffect, useRef, useState } from "react";
import {
  WI_LINK_LABELS, WI_LINK_TYPES, WI_PHASES_ALL, WI_PHASE_LABELS,
  WI_PRIORITIES, WI_PRIORITY_LABELS, WI_SEVERITIES, WI_SEVERITY_LABELS,
  legalWiMoves, normalizeTags, wiBlockedBy, wiSubtasks,
  type Item, type Role, type Snapshot, type WiLinkType, type WiPhase, type WiPriority, type WiSeverity,
  type WiState, type WiType, type WorkItem,
} from "@/lib/engine";
import { timeAgo } from "@/lib/format";
import {
  deleteAttachment, fetchAttachments, fetchComponents, fetchFieldDefs, fetchLabels,
  uploadAttachment, type AttachmentInfo, type FieldDefInfo,
} from "@/lib/api";
import { Avatar, TypeBox, WI_STATES, WI_TYPES } from "./badges";

const WI_TYPE_OPTS: WiType[] = ["story", "task", "bug"];

interface WorkItemDrawerProps {
  item: Item;
  snap: Snapshot;
  wiId: string;
  role: Role;
  onClose: () => void;
  onUpdate: (wiId: string, patch: Partial<WorkItem>) => void;
  onComment: (wiId: string, text: string) => void;
  onMove: (wiId: string, to: WiState) => void;
  onLink: (wiId: string, type: WiLinkType, target: string) => void;
  onUnlink: (wiId: string, type: WiLinkType, target: string) => void;
  onWorklog: (wiId: string, hours: number, note: string) => void;
}

/* Right-side drawer for the full Azure DevOps-style work-item form + discussion.
   Mounted with key={wiId} by the parent, so local field buffers are fresh per item.
   Text fields commit on blur; selects/tags/comments commit on change. */
export function WorkItemDrawer({ item, snap, wiId, onClose, onUpdate, onComment, onMove, onLink, onUnlink, onWorklog }: WorkItemDrawerProps) {
  const w = snap.workItems.find((x) => x.id === wiId);
  const asideRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(w?.title ?? "");
  const [description, setDescription] = useState(w?.description ?? "");
  const [acceptance, setAcceptance] = useState(w?.acceptanceCriteria ?? "");
  const [points, setPoints] = useState(w?.storyPoints != null ? String(w.storyPoints) : "");
  const [sprintBuf, setSprintBuf] = useState(w?.sprint ?? "");
  const [tagInput, setTagInput] = useState("");
  const [comment, setComment] = useState("");
  const [linkType, setLinkType] = useState<WiLinkType>("blocks");
  const [linkTarget, setLinkTarget] = useState("");
  const [origBuf, setOrigBuf] = useState(w?.originalEstimate != null ? String(w.originalEstimate) : "");
  const [remBuf, setRemBuf] = useState(w?.remainingEstimate != null ? String(w.remainingEstimate) : "");
  const [logHours, setLogHours] = useState("");
  const [logNote, setLogNote] = useState("");
  const [cfKey, setCfKey] = useState("");
  const [cfVal, setCfVal] = useState("");
  const [labelNames, setLabelNames] = useState<string[]>([]);
  const [componentNames, setComponentNames] = useState<string[]>([]);
  const [fieldDefs, setFieldDefs] = useState<FieldDefInfo[]>([]);
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [attErr, setAttErr] = useState<string | null>(null);
  const [attBusy, setAttBusy] = useState(false);

  async function reloadAttachments() {
    const r = await fetchAttachments(item.id, wiId);
    if (r.ok) setAttachments(r.data.attachments);
  }

  useEffect(() => {
    let stale = false;
    fetchAttachments(item.id, wiId).then((r) => { if (!stale && r.ok) setAttachments(r.data.attachments); });
    return () => { stale = true; };
  }, [item.id, wiId]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setAttBusy(true);
    const r = await uploadAttachment(item.id, file, wiId);
    setAttBusy(false);
    if (!r.ok) { setAttErr(r.error); return; }
    setAttErr(null);
    void reloadAttachments();
  }

  async function onDeleteAttachment(id: string) {
    const r = await deleteAttachment(id);
    if (!r.ok) { setAttErr(r.error); return; }
    setAttErr(null);
    void reloadAttachments();
  }

  // registries feed pickers only — work items keep storing plain strings
  useEffect(() => {
    let stale = false;
    fetchLabels().then((r) => { if (!stale && r.ok) setLabelNames(r.data.labels.map((l) => l.name)); });
    if (item.project)
      fetchComponents(item.project).then((r) => {
        if (!stale && r.ok) setComponentNames(r.data.components.map((c) => c.name));
      });
    fetchFieldDefs(item.project ?? null).then((r) => { if (!stale && r.ok) setFieldDefs(r.data.fields); });
    return () => { stale = true; };
  }, [item.project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // move focus into the dialog on open; restore it to the opener on close
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // minimal focus trap: keep Tab / Shift+Tab within the dialog
  function onTrapKey(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !asideRef.current) return;
    const focusable = Array.from(asideRef.current.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  if (!w) return null;

  const people = Array.from(new Set([
    ...item.stakeholders.map((s) => s.name),
    ...snap.workItems.map((x) => x.assignee),
  ].filter(Boolean)));
  const tags = w.tags || [];
  const comments = w.comments || [];
  const links = w.links || [];
  // incoming links: other items pointing at this one (derived, read-only here)
  const incoming = snap.workItems.flatMap((src) =>
    (src.links || []).filter((l) => l.target === wiId).map((l) => ({ type: l.type, source: src.id })));
  const blockedBy = wiBlockedBy(snap, wiId);
  const moves = legalWiMoves(w);
  const linkables = snap.workItems.filter((x) => x.id !== wiId);
  const subtasks = wiSubtasks(snap, wiId);
  const parentables = snap.workItems.filter((x) => x.id !== wiId && !x.parentWiId);
  const worklogs = w.worklogs || [];
  const customFields = w.customFields || {};

  function commitTitle() {
    const t = title.trim();
    if (!t) { setTitle(w!.title); return; }
    if (t !== w!.title) onUpdate(wiId, { title: t });
  }
  function commitDesc() { if (description !== (w!.description ?? "")) onUpdate(wiId, { description }); }
  function commitAcceptance() { if (acceptance !== (w!.acceptanceCriteria ?? "")) onUpdate(wiId, { acceptanceCriteria: acceptance }); }
  function commitPoints() {
    const raw = points.trim();
    const cur = w!.storyPoints;
    if (raw === "") { if (cur != null) onUpdate(wiId, { storyPoints: undefined }); return; } // clear
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) { if (n !== cur) onUpdate(wiId, { storyPoints: n }); }
    else setPoints(cur != null ? String(cur) : "");
  }
  function addTag() {
    const next = normalizeTags([...tags, tagInput]);
    setTagInput("");
    if (next.length !== tags.length) onUpdate(wiId, { tags: next });
  }
  function removeTag(t: string) { onUpdate(wiId, { tags: tags.filter((x) => x !== t) }); }
  function postComment() {
    const t = comment.trim();
    if (!t) return;
    onComment(wiId, t);
    setComment("");
  }
  function commitSprint() {
    const v = sprintBuf.trim();
    if (v !== (w!.sprint ?? "")) onUpdate(wiId, { sprint: v || undefined });
  }
  function addLink() {
    if (!linkTarget) return;
    onLink(wiId, linkType, linkTarget);
    setLinkTarget("");
  }
  function commitEstimate(buf: string, key: "originalEstimate" | "remainingEstimate", setBuf: (v: string) => void) {
    const raw = buf.trim();
    const cur = w![key];
    if (raw === "") { if (cur != null) onUpdate(wiId, { [key]: undefined }); return; } // clear
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) { if (n !== cur) onUpdate(wiId, { [key]: n }); }
    else setBuf(cur != null ? String(cur) : "");
  }
  function addCustomField() {
    const k = cfKey.trim(), v = cfVal.trim();
    if (!k || !v) return;
    const n = Number(v);
    onUpdate(wiId, { customFields: { [k]: v !== "" && Number.isFinite(n) && v === String(n) ? n : v } });
    setCfKey(""); setCfVal("");
  }
  function submitWorklog() {
    const n = Number(logHours);
    if (!Number.isFinite(n) || n <= 0) return;
    onWorklog(wiId, n, logNote.trim());
    setLogHours(""); setLogNote("");
    // remaining auto-decrements server-side; refresh the local buffer from the next derive
    setRemBuf("");
  }

  return (
    <>
      <div className="wi-drawer-scrim" onClick={onClose}></div>
      <aside ref={asideRef} className="wi-drawer" role="dialog" aria-modal="true"
        aria-label={`Work item ${w.id}`} onKeyDown={onTrapKey}>
        <div className="wi-drawer-head">
          <TypeBox type={w.type} size={20} />
          <span className="wid">{w.id}</span>
          <div style={{ flex: 1 }}></div>
          <button className="wi-act" title="Close" onClick={onClose}>✕</button>
        </div>

        <div className="wi-drawer-body scroll">
          <input className="wi-drawer-title" ref={titleRef} value={title} aria-label="Title"
            onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle}
            onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />

          <div className="wi-grid">
            <label className="wi-field"><span>State</span>
              {/* flow-checked: only the current state + legal moves from the WI workflow table */}
              <select value={w.state} onChange={(e) => onMove(wiId, e.target.value as WiState)}>
                <option value={w.state}>{WI_STATES[w.state].label}</option>
                {moves.map((s) => <option key={s} value={s}>→ {WI_STATES[s].label}</option>)}
              </select>
            </label>
            <label className="wi-field"><span>Type</span>
              <select value={w.type} onChange={(e) => onUpdate(wiId, { type: e.target.value as WiType })}>
                {!WI_TYPE_OPTS.includes(w.type) && <option value={w.type}>{WI_TYPES[w.type].label}</option>}
                {WI_TYPE_OPTS.map((t) => <option key={t} value={t}>{WI_TYPES[t].label}</option>)}
              </select>
            </label>
            <label className="wi-field"><span>Assignee</span>
              <select value={w.assignee} onChange={(e) => onUpdate(wiId, { assignee: e.target.value })}>
                <option value="">Unassigned</option>
                {!people.includes(w.assignee) && w.assignee && <option value={w.assignee}>{w.assignee}</option>}
                {people.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="wi-field"><span>Priority</span>
              <select value={w.priority ?? ""} onChange={(e) => onUpdate(wiId, { priority: e.target.value ? Number(e.target.value) as WiPriority : undefined })}>
                <option value="">—</option>
                {WI_PRIORITIES.map((p) => <option key={p} value={p}>{WI_PRIORITY_LABELS[p]}</option>)}
              </select>
            </label>
            <label className="wi-field"><span>Severity</span>
              <select value={w.severity ?? ""} onChange={(e) => onUpdate(wiId, { severity: e.target.value ? Number(e.target.value) as WiSeverity : undefined })}>
                <option value="">—</option>
                {WI_SEVERITIES.map((s) => <option key={s} value={s}>{WI_SEVERITY_LABELS[s]}</option>)}
              </select>
            </label>
            <label className="wi-field"><span>Story points</span>
              <input className="wi-num" inputMode="numeric" value={points} placeholder="—"
                onChange={(e) => setPoints(e.target.value)} onBlur={commitPoints}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            </label>
            <label className="wi-field"><span>Phase</span>
              <select value={w.phase ?? ""} onChange={(e) => onUpdate(wiId, { phase: e.target.value ? e.target.value as WiPhase : undefined })}>
                <option value="">—</option>
                {WI_PHASES_ALL.map((p) => <option key={p} value={p}>{WI_PHASE_LABELS[p]}</option>)}
              </select>
            </label>
            <label className="wi-field"><span>Sprint</span>
              <input value={sprintBuf} placeholder="—"
                onChange={(e) => setSprintBuf(e.target.value)} onBlur={commitSprint}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            </label>
            <label className="wi-field"><span>Component</span>
              {/* options come from the project registry; an off-registry value stays selectable */}
              <select value={w.component ?? ""} onChange={(e) => onUpdate(wiId, { component: e.target.value || undefined })}>
                <option value="">—</option>
                {w.component && !componentNames.includes(w.component) && <option value={w.component}>{w.component}</option>}
                {componentNames.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="wi-field"><span>Due date</span>
              {/* native date input emits "" or a valid YYYY-MM-DD — matches the engine's isIsoDate */}
              <input type="date" value={w.dueDate ?? ""}
                onChange={(e) => onUpdate(wiId, { dueDate: e.target.value || undefined })} />
            </label>
            <label className="wi-field"><span>Parent</span>
              {/* one level: only non-subtask WIs are eligible; a WI with subtasks can't become one */}
              <select value={w.parentWiId ?? ""} disabled={subtasks.length > 0}
                title={subtasks.length > 0 ? "Has subtasks — can't become a subtask" : "Subtask parent"}
                onChange={(e) => onUpdate(wiId, { parentWiId: e.target.value || undefined })}>
                <option value="">—</option>
                {parentables.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.title}</option>)}
              </select>
            </label>
            <label className="wi-field"><span>Original est. (h)</span>
              <input className="wi-num" inputMode="numeric" value={origBuf} placeholder="—"
                onChange={(e) => setOrigBuf(e.target.value)} onBlur={() => commitEstimate(origBuf, "originalEstimate", setOrigBuf)}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            </label>
            <label className="wi-field"><span>Remaining (h)</span>
              <input className="wi-num" inputMode="numeric" value={remBuf} placeholder={w.remainingEstimate != null ? String(w.remainingEstimate) : "—"}
                onChange={(e) => setRemBuf(e.target.value)} onBlur={() => commitEstimate(remBuf, "remainingEstimate", setRemBuf)}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            </label>
          </div>

          {blockedBy.length > 0 && w.state !== "done" &&
            <div className="banner blocked wi-blocked-banner">⛓ <b>Blocked</b> — open {blockedBy.length > 1 ? "items" : "item"} {blockedBy.join(", ")} must finish before this can be done.</div>}

          <label className="wi-field block"><span>Description</span>
            <textarea value={description} placeholder="What and why…" rows={4}
              onChange={(e) => setDescription(e.target.value)} onBlur={commitDesc} />
          </label>
          <label className="wi-field block"><span>Acceptance criteria</span>
            <textarea value={acceptance} placeholder="Done when…" rows={3}
              onChange={(e) => setAcceptance(e.target.value)} onBlur={commitAcceptance} />
          </label>

          <div className="wi-field block"><span>Tags</span>
            {/* managed label registry feeds autocomplete; free-form tags still allowed */}
            <datalist id="wi-label-options">
              {labelNames.map((l) => <option key={l} value={l} />)}
            </datalist>
            <div className="wi-tags">
              {tags.map((t) => (
                <span className="wi-tag" key={t}>{t}<button title="Remove tag" onClick={() => removeTag(t)}>×</button></span>
              ))}
              <input className="wi-tag-input" value={tagInput} placeholder="add tag…" maxLength={40}
                list="wi-label-options"
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
                onBlur={() => { if (tagInput.trim()) addTag(); }} />
            </div>
          </div>

          {fieldDefs.length > 0 &&
            <div className="wi-field block"><span>Fields</span>
              {/* defined custom fields: typed inputs writing per-key deltas into customFields */}
              <div className="wi-grid">
                {fieldDefs.map((d) => {
                  const cur = customFields[d.key];
                  const commit = (raw: string) => {
                    if (raw === "") { if (cur !== undefined) onUpdate(wiId, { customFields: { [d.key]: null } as unknown as Record<string, string> }); return; }
                    const v = d.kind === "number" ? Number(raw) : raw;
                    if (d.kind === "number" && !Number.isFinite(v as number)) return;
                    if (v !== cur) onUpdate(wiId, { customFields: { [d.key]: v } });
                  };
                  return (
                    <label className="wi-field" key={d.id}><span>{d.name}{d.scope ? "" : " ⦿"}</span>
                      {d.kind === "select" ? (
                        <select value={cur != null ? String(cur) : ""} onChange={(e) => commit(e.target.value)}>
                          <option value="">—</option>
                          {cur != null && !(d.options || []).includes(String(cur)) && <option value={String(cur)}>{String(cur)}</option>}
                          {(d.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input type={d.kind === "number" ? "number" : d.kind === "date" ? "date" : "text"}
                          defaultValue={cur != null ? String(cur) : ""} placeholder="—" maxLength={2000}
                          onBlur={(e) => commit(e.target.value.trim())}
                          onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                      )}
                    </label>
                  );
                })}
              </div>
            </div>}

          <div className="wi-field block"><span>Custom fields <span className="wi-cc">{Object.keys(customFields).length}</span></span>
            <div className="wi-links">
              {Object.keys(customFields).length === 0 && <div className="wi-empty">No custom fields.</div>}
              {Object.entries(customFields).map(([k, v]) => (
                <div className="wi-link-row" key={k}>
                  <span className="wi-link-kind">{k}</span>
                  <span className="wi-link-title">{String(v)}</span>
                  <button className="wi-act del" title={`Remove ${k}`}
                    onClick={() => onUpdate(wiId, { customFields: { [k]: null } as unknown as Record<string, string> })}>✕</button>
                </div>
              ))}
            </div>
            <div className="wi-link-add">
              <input value={cfKey} placeholder="field" aria-label="Custom field name" maxLength={64}
                onChange={(e) => setCfKey(e.target.value)} style={{ width: 110 }} />
              <input value={cfVal} placeholder="value" aria-label="Custom field value" maxLength={2000}
                onChange={(e) => setCfVal(e.target.value)} style={{ flex: 1 }} />
              <button className="wi-act ok" title="Set field" onClick={addCustomField} disabled={!cfKey.trim() || !cfVal.trim()}>＋</button>
            </div>
          </div>

          <div className="wi-field block"><span>Attachments <span className="wi-cc">{attachments.length}</span></span>
            <div className="wi-links">
              {attachments.length === 0 && <div className="wi-empty">No attachments.</div>}
              {attachments.map((a) => (
                <div className="wi-link-row" key={a.id}>
                  <a className="wi-link-title" href={`/api/attachments/${encodeURIComponent(a.id)}`}
                    title={`${a.filename} · ${(a.size / 1024).toFixed(1)} KB · ${a.uploader}`}>
                    📎 {a.filename}
                  </a>
                  <span className="mono" style={{ color: "var(--text-3)", fontSize: 10 }}>{(a.size / 1024).toFixed(1)} KB</span>
                  <button className="wi-act del" title={`Delete ${a.filename}`} onClick={() => void onDeleteAttachment(a.id)}>✕</button>
                </div>
              ))}
            </div>
            <div className="wi-link-add">
              <input type="file" aria-label="Upload attachment" disabled={attBusy} onChange={(e) => void onPickFile(e)} />
              {attBusy && <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>uploading…</span>}
            </div>
            {attErr && <div className="mono" style={{ color: "var(--danger, #c33)", fontSize: 11, paddingTop: 4 }}>⚠ {attErr}</div>}
          </div>

          <div className="wi-field block"><span>Links <span className="wi-cc">{links.length + incoming.length}</span></span>
            <div className="wi-links">
              {links.length === 0 && incoming.length === 0 && <div className="wi-empty">No links yet.</div>}
              {links.map((l) => {
                const t = snap.workItems.find((x) => x.id === l.target);
                return (
                  <div className="wi-link-row" key={"out:" + l.type + ":" + l.target}>
                    <span className="wi-link-kind">{WI_LINK_LABELS[l.type].out}</span>
                    <span className="mono wid">{l.target}</span>
                    <span className="wi-link-title">{t?.title ?? ""}</span>
                    <button className="wi-act del" title="Remove link" onClick={() => onUnlink(wiId, l.type, l.target)}>✕</button>
                  </div>
                );
              })}
              {incoming.map((l) => {
                const s = snap.workItems.find((x) => x.id === l.source);
                return (
                  <div className="wi-link-row in" key={"in:" + l.type + ":" + l.source}>
                    <span className="wi-link-kind">{WI_LINK_LABELS[l.type].in}</span>
                    <span className="mono wid">{l.source}</span>
                    <span className="wi-link-title">{s?.title ?? ""}</span>
                  </div>
                );
              })}
            </div>
            {linkables.length > 0 &&
              <div className="wi-link-add">
                <select className="wi-sel" value={linkType} onChange={(e) => setLinkType(e.target.value as WiLinkType)} title="Link type">
                  {WI_LINK_TYPES.map((t) => <option key={t} value={t}>{WI_LINK_LABELS[t].out}</option>)}
                </select>
                <select className="wi-sel" value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)} title="Link target">
                  <option value="">choose item…</option>
                  {linkables.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.title}</option>)}
                </select>
                <button className="wi-act ok" title="Add link" onClick={addLink} disabled={!linkTarget}>＋</button>
              </div>}
          </div>

          {subtasks.length > 0 &&
            <div className="wi-field block"><span>Subtasks <span className="wi-cc">{subtasks.filter((s) => s.state === "done").length}/{subtasks.length} done</span></span>
              <div className="wi-links">
                {subtasks.map((s) => (
                  <div className="wi-link-row" key={s.id}>
                    <span className="wi-link-kind">{WI_STATES[s.state].label}</span>
                    <span className="mono wid">{s.id}</span>
                    <span className="wi-link-title">{s.title}</span>
                  </div>
                ))}
              </div>
            </div>}

          <div className="wi-field block"><span>Time tracking <span className="wi-cc">{w.timeSpent ?? 0}h logged</span></span>
            <div className="wi-links">
              {worklogs.length === 0 && <div className="wi-empty">No work logged yet.</div>}
              {worklogs.map((l) => (
                <div className="wi-link-row" key={l.id}>
                  <span className="wi-link-kind">{l.hours}h</span>
                  <span className="mono wid">{l.author}</span>
                  <span className="wi-link-title">{l.text ?? ""} · {timeAgo(l.ts)}</span>
                </div>
              ))}
            </div>
            <div className="wi-link-add">
              <input className="wi-num" inputMode="decimal" value={logHours} placeholder="hours" aria-label="Hours worked"
                onChange={(e) => setLogHours(e.target.value)} style={{ width: 70 }} />
              <input value={logNote} placeholder="note (optional)" aria-label="Worklog note" maxLength={2000}
                onChange={(e) => setLogNote(e.target.value)} style={{ flex: 1 }} />
              <button className="wi-act ok" title="Log work" onClick={submitWorklog}
                disabled={!Number.isFinite(Number(logHours)) || Number(logHours) <= 0}>＋</button>
            </div>
          </div>

          <div className="wi-field block">
            <span>Discussion <span className="wi-cc">{comments.length}</span></span>
            <div className="wi-comments">
              {comments.length === 0 && <div className="wi-empty">No comments yet.</div>}
              {comments.map((c) => (
                <div className="wi-comment" key={c.id}>
                  <Avatar name={c.author} size={22} />
                  <div className="wi-comment-b">
                    <div className="wi-comment-h"><b>{c.author}</b><span className="kpill">{c.role}</span><span className="wi-cm-t">· {timeAgo(c.ts)}</span></div>
                    <div className="wi-comment-text">{c.text}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="wi-comment-add">
              <textarea value={comment} placeholder="Add a comment…  (⌘/Ctrl+Enter to post)" rows={2}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); postComment(); } }} />
              <button className="act primary" onClick={postComment} disabled={!comment.trim()}>Post</button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
