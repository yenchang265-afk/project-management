"use client";

/* =========================================================================
   APP — composition + server-backed event mutation.
   All writes go through POST /api/items/:id/commands (the server runs the
   same pure engine); the client appends the RETURNED event and re-derives.
   409 (stale) → swap in the fresh item; 422 → typed rejection toast.
   ========================================================================= */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  GATES, STATES, deriveItem, label,
  type FlagKey, type GateKey, type Item, type PdlcEvent, type Rejection, type Role,
  type SubtrackState, type TrackKey, type TransitionDef, type WiLinkType, type WiState, type WiType, type WorkItem,
} from "@/lib/engine";
import { buildSeed } from "@/lib/seed";
import {
  fetchItems, fetchMe, logout, postCommand, postSpawn, type ApiUser,
} from "@/lib/api";
import { Avatar, StateBadge, TypeBox, WI_TYPES } from "./badges";
import { Actions } from "./Actions";
import { Analytics } from "./Analytics";
import { Board } from "./Board";
import { GateInspector } from "./GateInspector";
import { History } from "./History";
import { Navigator } from "./Navigator";
import { PlanVsActual } from "./PlanVsActual";
import { RequirementDocs } from "./docs";
import { Spine } from "./Spine";
import { Stakeholders } from "./Stakeholders";
import { SubTracks } from "./SubTracks";
import { Toasts, type Toast } from "./Toasts";
import { WorkItems } from "./WorkItems";
import { WorkItemDrawer } from "./WorkItemDrawer";

/* Prototype tweak defaults, baked in (the Tweaks panel was design-tool chrome). */
const THEME = { accent: "#5b5fd6", density: "regular", dark: false };

/* Org/group structure is still a static fixture — the hierarchy table is Phase 3.
   buildSeed's ITEMS are ignored; the database is the source of truth for items. */
const ORG_META = buildSeed(0);

const LANE_FILTERS = [
  { key: "all", label: "All" },
  { key: "discovery", label: "Discovery" },
  { key: "build", label: "Build" },
  { key: "verify", label: "Verify" },
  { key: "release", label: "Release" },
  { key: "closed", label: "Closed" },
];

function rejDetail(r: Rejection): string | null {
  const d = r.detail || {};
  switch (r.type) {
    case "GATE_CONDITIONS_UNSATISFIED": return "unsatisfied → " + (d.conditions as string[]).join(", ");
    case "GATE_SIGNOFF_MISSING": return "missing → " + (d.missing as string[]).join(" + ");
    case "ROLE_GUARD": return "your role: " + d.actorRole + " · needs: " + (d.required as string[]).join(" or ");
    case "ILLEGAL_TRANSITION": return d.from + " ✗→ " + d.to;
    case "REASON_REQUIRED": return "allowed → " + (d.allowed as string[]).join(", ");
    default: return null;
  }
}

/* JSON drops undefined keys, so "clear this field" travels as null (server converts back). */
const CLEARABLE = ["priority", "storyPoints", "severity", "phase", "sprint"] as const;
function toWire(patch: Partial<WorkItem>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch };
  for (const k of CLEARABLE) if (k in patch && patch[k] === undefined) out[k] = null;
  return out;
}

export default function App() {
  const [me, setMe] = useState<ApiUser | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selId, setSelId] = useState("PAY-412");
  const [view, setView] = useState<"detail" | "board">("detail");
  const [openWiId, setOpenWiId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [org, setOrg] = useState(ORG_META.org.name);
  const [orgOpen, setOrgOpen] = useState(false);
  const GROUPS = ORG_META.groups;
  // versionsRef mirrors `versions` so queued commands read the LATEST version, not a
  // stale render closure; queues serialize commands per item (rapid edits would
  // otherwise race each other into 409s).
  const versionsRef = useRef<Record<string, number>>({});
  const queues = useRef<Record<string, Promise<boolean>>>({});

  function toggleNode(k: string) {
    setCollapsed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }

  // apply theme to <html>
  useLayoutEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", THEME.dark ? "dark" : "light");
    r.setAttribute("data-density", THEME.density);
    r.style.setProperty("--accent", THEME.accent);
  }, []);

  // initial load: session user + items (401 inside the helpers redirects to /login)
  useEffect(() => {
    (async () => {
      const meRes = await fetchMe();
      if (!meRes.ok) { if (meRes.status !== 401) setLoadError(meRes.error); return; }
      setMe(meRes.data.user);
      const itemsRes = await fetchItems();
      if (!itemsRes.ok) { setLoadError(itemsRes.error); return; }
      setItems(itemsRes.data.items);
      setVersions(itemsRes.data.versions);
      versionsRef.current = { ...itemsRes.data.versions };
      if (!itemsRes.data.items.some((i) => i.id === "PAY-412") && itemsRes.data.items[0])
        setSelId(itemsRes.data.items[0].id);
    })();
  }, []);

  function pushToast(o: Omit<Toast, "id">) {
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 5);
    setToasts((ts) => [...ts, { id, ...o }]);
  }
  function dismiss(id: string) { setToasts((ts) => ts.filter((x) => x.id !== id)); }

  if (loadError) return <div className="app-loading error">⚠ {loadError}</div>;
  if (!me || !items) return <div className="app-loading">Loading Cadence…</div>;

  const role: Role = me.role;
  const actor = me.name;
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const item = byId[selId] || items[0];
  if (!item) return <div className="app-loading">No items yet.</div>;
  const snap = deriveItem(item);

  function applyServerEvent(itemId: string, event: PdlcEvent, version: number) {
    setItems((its) => (its || []).map((it) => (it.id === itemId ? { ...it, events: [...it.events, event] } : it)));
    setVersions((v) => ({ ...v, [itemId]: version }));
    versionsRef.current[itemId] = version;
  }
  function replaceItem(fresh: Item, version: number) {
    setItems((its) => (its || []).map((it) => (it.id === fresh.id ? fresh : it)));
    setVersions((v) => ({ ...v, [fresh.id]: version }));
    versionsRef.current[fresh.id] = version;
  }

  /** Send a command; resolve true on success. Commands for the same item are
   *  serialized through a queue so rapid edits don't race into 409s. */
  function sendCmd(itemId: string, command: unknown, okToast?: Omit<Toast, "id">): Promise<boolean> {
    const prev = queues.current[itemId] || Promise.resolve(true);
    const next = prev.then(() => sendNow(itemId, command, okToast), () => sendNow(itemId, command, okToast));
    queues.current[itemId] = next;
    return next;
  }
  async function sendNow(itemId: string, command: unknown, okToast?: Omit<Toast, "id">): Promise<boolean> {
    const res = await postCommand(itemId, command, versionsRef.current[itemId] ?? byId[itemId]?.events.length ?? 0);
    if (res.ok) {
      applyServerEvent(itemId, res.data.event, res.data.version);
      if (okToast) pushToast(okToast);
      return true;
    }
    if (res.status === 409 && res.data) {
      const d = res.data as { item: Item; version: number };
      replaceItem(d.item, d.version);
      pushToast({ ok: false, message: "Item changed elsewhere — view refreshed, try again." });
      return false;
    }
    const rej = (res.data as { rejection?: Rejection } | undefined)?.rejection;
    pushToast({ ok: false, type: rej?.type, message: res.error, detail: rej ? rejDetail(rej) : null });
    return false;
  }

  /* ---- transition bridge ---- */
  function doTransition(def: TransitionDef, reason: string | null) {
    void sendCmd(item.id, { kind: "transition", to: def.to, reason },
      { ok: true, message: `${def.label} — now ${label(def.to)}`, detail: `${label(def.from)} → ${label(def.to)}` });
  }

  /* ---- client-side guard: instant feedback; the server re-enforces everything ---- */
  function guard(neededRole: Role, what: string) {
    if (role !== neededRole) {
      pushToast({ ok: false, type: "ROLE_GUARD", message: `Only ${neededRole} can ${what}.`, detail: `your role: ${role}` });
      return false;
    }
    return true;
  }
  function findCond(key: string) {
    for (const g of Object.values(GATES)) { const c = g.conditions.find((x) => x.key === key); if (c) return c; }
    return { owner: "PM" as Role };
  }
  function satisfyCond(key: string) {
    if (!guard(findCond(key).owner, `satisfy ${key}`)) return;
    void sendCmd(item.id, { kind: "condition", op: "satisfy", key });
  }
  function waiveCond(key: string) {
    if (!guard(findCond(key).owner, `waive ${key}`)) return;
    void sendCmd(item.id, { kind: "condition", op: "waive", key });
  }
  function signoff(gate: GateKey, slot: Role) {
    if (!guard(slot, `sign the ${slot} slot`)) return;
    void sendCmd(item.id, { kind: "signoff", gate });
  }
  function shiftLeft(risk: string, value: boolean) {
    if (!guard("PM", "set risk flags")) return;
    void sendCmd(item.id, { kind: "shiftLeft", risk, value });
  }
  function subtrack(track: TrackKey, to: SubtrackState) {
    const owner: Role = track === "security" ? "Dev" : "PM";
    if (!guard(owner, `advance the ${track} review`)) return;
    void sendCmd(item.id, { kind: "subtrack", track, to });
  }
  function toggleFlag(flag: FlagKey) {
    const on = !!snap.flags[flag];
    const reason = on ? null : flag === "blocked" ? "Flagged blocked" : "Put on hold";
    void sendCmd(item.id, { kind: "flag", flag, value: !on, reason });
  }

  /* ---- iteration loop: server creates the child + lineage event atomically ---- */
  async function spawnIteration() {
    if (!guard("PM", "spawn the next iteration")) return;
    const res = await postSpawn(item.id, versions[item.id] ?? item.events.length);
    if (res.ok) {
      const { child, parentEvent, parentVersion } = res.data;
      setItems((its) => [...(its || []).map((it) => (it.id === item.id ? { ...it, events: [...it.events, parentEvent] } : it)), child]);
      setVersions((v) => ({ ...v, [item.id]: parentVersion, [child.id]: child.events.length }));
      setSelId(child.id);
      pushToast({ ok: true, message: `Spawned iteration ${child.id}`, detail: `parent → ${item.id}` });
    } else if (res.status === 409 && res.data) {
      const d = res.data as { item: Item; version: number };
      replaceItem(d.item, d.version);
      pushToast({ ok: false, message: "Item changed elsewhere — view refreshed, try again." });
    } else {
      pushToast({ ok: false, message: res.error });
    }
  }

  /* ---- work items (server-validated commands) ---- */
  function addWorkItem(draft: { type: WiType; title: string; assignee: string; state?: WiState }) {
    void sendCmd(item.id, { kind: "wiCreate", draft }, { ok: true, message: "Added work item", detail: draft.title });
  }
  function editWorkItem(wiId: string, patch: Partial<WorkItem>) {
    void sendCmd(item.id, { kind: "wiUpdate", wiId, patch: toWire(patch) });
  }
  function removeWorkItem(wiId: string) {
    void sendCmd(item.id, { kind: "wiDelete", wiId }, { ok: true, message: `Removed work item ${wiId}` });
  }
  function commentOnWorkItem(wiId: string, text: string) {
    void sendCmd(item.id, { kind: "wiComment", wiId, text });
  }
  function moveWorkItemOn(itemId: string, wiId: string, to: WiState) {
    void sendCmd(itemId, { kind: "wiMove", wiId, to });
  }
  function moveWorkItem(wiId: string, to: WiState) { moveWorkItemOn(item.id, wiId, to); }
  function linkWi(wiId: string, type: WiLinkType, target: string) {
    void sendCmd(item.id, { kind: "wiLink", wiId, type, target });
  }
  function unlinkWi(wiId: string, type: WiLinkType, target: string) {
    void sendCmd(item.id, { kind: "wiUnlink", wiId, type, target });
  }
  function rankWi(wiId: string, toIndex: number) {
    void sendCmd(item.id, { kind: "wiReorder", wiId, toIndex });
  }
  function openFromBoard(itemId: string, wiId: string) {
    setSelId(itemId);
    setOpenWiId(wiId);
  }

  async function doLogout() {
    await logout();
    window.location.href = "/login";
  }

  /* ---- which gate to surface ---- */
  const curSpine = STATES[snap.state] ? STATES[snap.state].spine ?? null : null;
  const showReadyGate = curSpine != null && curSpine <= 4;
  const showRelease = curSpine != null && curSpine >= 4;
  const offSpine = STATES[snap.state] && STATES[snap.state].lane === "off";

  function laneCount(f: string) {
    if (f === "all") return items!.length;
    return items!.filter((it) => {
      const lane = STATES[deriveItem(it).state].lane;
      return f === "closed" ? lane === "closed" || lane === "off" : lane === f;
    }).length;
  }

  const child = items.filter((i) => i.parent === item.id);

  return (
    <div className="app">
      {/* TOP BAR */}
      <div className="topbar">
        <div className="brand">
          <span className="glyph">C</span>
          <span>Cadence</span>
        </div>
        <div className="viewswitch">
          {(["detail", "board"] as const).map((v) => (
            <button key={v} data-on={view === v} onClick={() => setView(v)}>
              {v === "detail" ? "▤ Details" : "▦ Board"}
            </button>
          ))}
        </div>
        <div className="spacer"></div>
        <div className="who">
          <Avatar name={actor} /> <span>{actor}</span>
          <span className="kpill" data-role={role}>{role === "PM" ? "Product" : "Engineering"}</span>
          <button className="wi-act logout" title="Sign out" onClick={doLogout}>⎋</button>
        </div>
      </div>

      <div className="body">
        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="org-wrap">
            <button className="org-switch" onClick={() => setOrgOpen((o) => !o)}>
              <span className="org-glyph">{org[0]}</span>
              <span className="org-meta">
                <span className="org-name">{org}</span>
                <span className="org-sub">{ORG_META.org.sub} · {items.length} items</span>
              </span>
              <span className="chev">▾</span>
            </button>
            {orgOpen && <>
              <div className="scrim" onClick={() => setOrgOpen(false)}></div>
              <div className="pop org-pop">
                <div className="ph">Organization</div>
                {ORG_META.orgs.map((o) => (
                  <button key={o} onClick={() => { setOrg(o); setOrgOpen(false); }}>
                    <span className="org-glyph sm">{o[0]}</span>{o}
                    {o === org && <span style={{ marginLeft: "auto", color: "var(--ok)" }}>✓</span>}
                  </button>
                ))}
              </div>
            </>}
          </div>
          <div className="side-head">
            <div className="nav-search">
              <span className="ns-ic">⌕</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items…" />
              {query && <button className="ns-x" onClick={() => setQuery("")}>×</button>}
            </div>
            <div className="lanefilter">
              {LANE_FILTERS.map((f) => (
                <button key={f.key} data-on={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label} <span className="mono" style={{ opacity: 0.6 }}>{laneCount(f.key)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="itemtree scroll">
            <Navigator groups={GROUPS} items={items} selId={selId} onSelect={setSelId}
              filter={filter} search={query} collapsed={collapsed} onToggle={toggleNode} />
          </div>
        </aside>

        {/* BOARD */}
        {view === "board" &&
          <main className="detail board-main">
            <Board items={items} onMove={moveWorkItemOn} onOpen={openFromBoard} />
          </main>}

        {/* DETAIL */}
        {view === "detail" && <main className="detail">
          <div className="detail-head">
            <div className="crumbs">
              <span className="c">{org}</span><span className="sep">›</span>
              <span className="c">{(GROUPS.find((g) => g.teams.includes(item.area)) || { label: "—" }).label}</span><span className="sep">›</span>
              <span className="c">{item.area}</span>
              {item.parent && byId[item.parent] &&
                <><span className="sep">›</span><button className="c link" onClick={() => setSelId(item.parent!)}>{item.parent}</button></>}
              <span className="sep">›</span><span className="cur">{item.id}</span>
            </div>
            <div className="dh-top">
              <TypeBox type={item.type} size={22} />
              <span className="id">{item.id}</span>
              <h1>{item.title}</h1>
              <StateBadge stateKey={snap.state} />
            </div>
            <div className="dh-meta">
              <span className="chip" style={{ background: "var(--surface-2)", color: "var(--text-2)", border: "1px solid var(--border)" }}>{(WI_TYPES[item.type] || WI_TYPES.feature).label}</span>
              <span className="chip" style={{ background: "var(--surface-2)", color: "var(--text-2)", border: "1px solid var(--border)" }}>{item.area}</span>
              <span className={"prio " + item.priority}>{item.priority} priority</span>
              {item.parent && <><span className="metasep"></span>
                <button className="lineage" onClick={() => setSelId(item.parent!)}>⎇ iteration of {item.parent}</button></>}
              {child.length > 0 && <><span className="metasep"></span>
                <button className="lineage" onClick={() => setSelId(child[0].id)}>⎇ {child.length} child {child.length > 1 ? "iterations" : "iteration"}</button></>}
              <div className="spacer"></div>
              <div className="flagbtns">
                {(["blocked", "on_hold"] as FlagKey[]).map((f) => (
                  <button key={f} className={"flagbtn " + f} data-on={!!snap.flags[f]} onClick={() => toggleFlag(f)}>
                    {f === "blocked" ? "⚑" : "⏸"} {f === "blocked" ? "Blocked" : "On hold"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="detail-scroll scroll">
            {snap.flags.blocked && <div className="banner blocked">⚑ <b>Blocked</b> — {snap.flags.blocked.reason}. Flag is orthogonal to state; the item stays in {label(snap.state)}.</div>}
            {snap.flags.on_hold && <div className="banner on_hold">⏸ <b>On hold</b> — {snap.flags.on_hold.reason}.</div>}

            <Spine snap={snap} />

            <PlanVsActual item={item} />

            <div className="detail-grid">
              <div className="stack">
                <div className="card">
                  <div className="card-h">
                    <h3>Available actions</h3>
                    <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>as {role} · from {label(snap.state)}</span>
                  </div>
                  <div className="card-b">
                    <Actions snap={snap} role={role} onTransition={doTransition} />
                  </div>
                </div>

                <RequirementDocs item={item} snap={snap} />

                {snap.state === "monitoring" &&
                  <div className="card">
                    <div className="card-h"><h3>⎇ Iteration loop</h3><span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>PM-owned</span></div>
                    <div className="card-b">
                      <button className="act primary" onClick={spawnIteration} style={{ width: "100%" }}>
                        <span className="ai">⎇</span>
                        <span className="txt"><span className="t1">Spawn next iteration</span>
                          <span className="t2">creates linked child · keeps lineage</span></span>
                      </button>
                      <div className="sl-note" style={{ paddingTop: 10 }}>Does <b>not</b> reopen this item — it stays on its path to Done. A new child item is created with <span className="mono">parent_id = {item.id}</span>.</div>
                    </div>
                  </div>}

                {!offSpine && showReadyGate &&
                  <GateInspector gateKey="ready_for_dev" snap={snap} role={role}
                    onSatisfy={satisfyCond} onWaive={waiveCond} onSignoff={signoff} onShiftLeft={shiftLeft} showShiftLeft={true} />}
                {!offSpine && showRelease &&
                  <GateInspector gateKey="release" snap={snap} role={role}
                    onSatisfy={satisfyCond} onWaive={waiveCond} onSignoff={signoff} showShiftLeft={false} />}
                {!offSpine && showRelease &&
                  <SubTracks snap={snap} role={role} onSubtrack={subtrack} />}
              </div>

              <div className="stack">
                <Stakeholders item={item} snap={snap} />
                <WorkItems key={item.id} item={item} snap={snap} role={role}
                  onCreate={addWorkItem} onUpdate={editWorkItem} onDelete={removeWorkItem} onOpen={setOpenWiId}
                  onMove={moveWorkItem} onReorder={rankWi} />
                <History item={item} />
                <Analytics item={item} />
              </div>
            </div>
            <div className="foot-note">events are the single source of truth · current state, gates, flags &amp; analytics are all derived · persisted in MariaDB</div>
          </div>
        </main>}
      </div>

      {openWiId && snap.workItems.some((w) => w.id === openWiId) &&
        <WorkItemDrawer key={item.id + ":" + openWiId} item={item} snap={snap} wiId={openWiId} role={role}
          onClose={() => setOpenWiId(null)} onUpdate={editWorkItem} onComment={commentOnWorkItem}
          onMove={moveWorkItem} onLink={linkWi} onUnlink={unlinkWi} />}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
