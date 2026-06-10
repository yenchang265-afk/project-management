"use client";

import { useEffect, useRef, useState } from "react";
import {
  WI_LINK_LABELS, WI_LINK_TYPES, WI_PHASES_ALL, WI_PHASE_LABELS,
  WI_PRIORITIES, WI_PRIORITY_LABELS, WI_SEVERITIES, WI_SEVERITY_LABELS,
  legalWiMoves, normalizeTags, wiBlockedBy,
  type Item, type Role, type Snapshot, type WiLinkType, type WiPhase, type WiPriority, type WiSeverity,
  type WiState, type WiType, type WorkItem,
} from "@/lib/engine";
import { timeAgo } from "@/lib/format";
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
}

/* Right-side drawer for the full Azure DevOps-style work-item form + discussion.
   Mounted with key={wiId} by the parent, so local field buffers are fresh per item.
   Text fields commit on blur; selects/tags/comments commit on change. */
export function WorkItemDrawer({ item, snap, wiId, onClose, onUpdate, onComment, onMove, onLink, onUnlink }: WorkItemDrawerProps) {
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
            <div className="wi-tags">
              {tags.map((t) => (
                <span className="wi-tag" key={t}>{t}<button title="Remove tag" onClick={() => removeTag(t)}>×</button></span>
              ))}
              <input className="wi-tag-input" value={tagInput} placeholder="add tag…" maxLength={40}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
                onBlur={() => { if (tagInput.trim()) addTag(); }} />
            </div>
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
