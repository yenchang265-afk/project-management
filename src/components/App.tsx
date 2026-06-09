"use client";

/* =========================================================================
   APP — composition, role-driven dispatch, event mutation.
   ========================================================================= */
import { useLayoutEffect, useState } from "react";
import {
  GATES, STATES,
  applyTransition, createWorkItem, deleteWorkItem, deriveItem, ev, label, updateWorkItem,
  type FlagKey, type GateKey, type Item, type Rejection, type Role,
  type SubtrackState, type TrackKey, type TransitionDef, type WiState, type WiType, type WorkItem,
} from "@/lib/engine";
import { buildSeed, type SeedData } from "@/lib/seed";
import { Avatar, StateBadge, TypeBox, WI_TYPES } from "./badges";
import { Actions } from "./Actions";
import { Analytics } from "./Analytics";
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

const CURRENT_USER: Record<Role, string> = { PM: "Maya Chen", Dev: "Sam Okafor" };

/* Prototype tweak defaults, baked in (the Tweaks panel was design-tool chrome). */
const THEME = { accent: "#5b5fd6", density: "regular", dark: false };

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

export default function App() {
  const [seed] = useState<SeedData>(() => buildSeed(Date.now()));
  const [items, setItems] = useState<Item[]>(() => seed.ITEMS.map((it) => ({ ...it, events: it.events.slice() })));
  const [role, setRole] = useState<Role>("PM");
  const [selId, setSelId] = useState("PAY-412");
  const [filter, setFilter] = useState("all");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [org, setOrg] = useState(seed.org.name);
  const [orgOpen, setOrgOpen] = useState(false);
  const GROUPS = seed.groups;

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

  const actor = CURRENT_USER[role];
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const item = byId[selId];
  const snap = deriveItem(item);

  function pushToast(o: Omit<Toast, "id">) {
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 5);
    setToasts((ts) => [...ts, { id, ...o }]);
  }
  function dismiss(id: string) { setToasts((ts) => ts.filter((x) => x.id !== id)); }

  function append(itemId: string, event: ReturnType<typeof ev>) {
    setItems((its) => its.map((it) => (it.id === itemId ? { ...it, events: [...it.events, event] } : it)));
  }

  /* ---- transition engine bridge ---- */
  function doTransition(def: TransitionDef, reason: string | null) {
    const res = applyTransition(item, def.to, actor, role, reason);
    if (res.ok) {
      append(item.id, res.event);
      pushToast({ ok: true, message: `${def.label} — now ${label(def.to)}`, detail: `${label(def.from)} → ${label(def.to)}` });
    } else {
      pushToast({ ok: false, type: res.rejection.type, message: res.rejection.message, detail: rejDetail(res.rejection) });
    }
  }

  /* ---- condition / gate / subtrack / flag dispatch (role-guarded) ---- */
  function guard(neededRole: Role, what: string) {
    if (role !== neededRole) {
      pushToast({ ok: false, type: "ROLE_GUARD", message: `Only ${neededRole} can ${what}.`, detail: `your role: ${role}` });
      return false;
    }
    return true;
  }
  function satisfyCond(key: string) {
    const c = findCond(key);
    if (!guard(c.owner, `satisfy ${key}`)) return;
    append(item.id, ev(item.id, "CONDITION_SATISFY", actor, role, { condition: key }));
  }
  function waiveCond(key: string) {
    const c = findCond(key);
    if (!guard(c.owner, `waive ${key}`)) return;
    append(item.id, ev(item.id, "CONDITION_WAIVE", actor, role, { condition: key }));
  }
  function signoff(gate: GateKey, slot: Role) {
    if (!guard(slot, `sign the ${slot} slot`)) return;
    append(item.id, ev(item.id, "GATE_SIGNOFF", actor, role, { gate }));
  }
  function shiftLeft(risk: string, value: boolean) {
    if (!guard("PM", "set risk flags")) return;
    append(item.id, ev(item.id, "SHIFT_LEFT_SET", actor, role, { risk, value }));
  }
  function subtrack(track: TrackKey, to: SubtrackState) {
    const owner: Role = track === "security" ? "Dev" : "PM";
    if (!guard(owner, `advance the ${track} review`)) return;
    append(item.id, ev(item.id, "SUBTRACK", actor, role, { track, to }));
  }
  function toggleFlag(flag: FlagKey) {
    const on = !!snap.flags[flag];
    const reason = on ? null : flag === "blocked" ? "Flagged blocked" : "Put on hold";
    append(item.id, ev(item.id, "FLAG_SET", actor, role, { flag, value: !on, reason }));
  }
  function findCond(key: string) {
    for (const g of Object.values(GATES)) { const c = g.conditions.find((x) => x.key === key); if (c) return c; }
    return { owner: "PM" as Role };
  }

  /* ---- iteration loop: spawn a linked child ---- */
  function spawnIteration() {
    if (!guard("PM", "spawn the next iteration")) return;
    const prefix = item.id.split("-")[0];
    const childId = prefix + "-" + (500 + Math.floor(Math.random() * 480));
    const child: Item = {
      id: childId,
      title: item.title.replace(/\s*\(iteration.*\)$/i, "") + " (next iteration)",
      area: item.area, priority: "Medium", parent: item.id, type: "feature", workItems: [],
      stakeholders: [
        { role: "Product Manager", name: CURRENT_USER.PM },
        { role: "Engineering Manager", name: "Marcus Lin" },
        { role: "Tech Lead", name: CURRENT_USER.Dev },
        { role: "Designer", name: "Lena Petrova" },
      ],
      events: [ev(childId, "CREATE", actor, role, { to: "backlog" })],
    };
    setItems((its) => [
      ...its.map((it) => (it.id === item.id ? { ...it, events: [...it.events, ev(item.id, "SPAWN_CHILD", actor, role, { child: childId })] } : it)),
      child,
    ]);
    setSelId(childId);
    pushToast({ ok: true, message: `Spawned iteration ${childId}`, detail: `parent → ${item.id}` });
  }

  /* ---- work item CRUD (both roles; validated in the engine) ---- */
  function addWorkItem(draft: { type: WiType; title: string; assignee: string; state?: WiState }) {
    const res = createWorkItem(item, snap, draft, actor, role);
    if (res.ok) {
      append(item.id, res.event);
      pushToast({ ok: true, message: `Added work item ${res.event.wiId}`, detail: draft.title });
    } else pushToast({ ok: false, message: res.error });
  }
  function editWorkItem(wiId: string, patch: Partial<WorkItem>) {
    const res = updateWorkItem(item, snap, wiId, patch, actor, role);
    if (res.ok) append(item.id, res.event);
    else pushToast({ ok: false, message: res.error });
  }
  function removeWorkItem(wiId: string) {
    const res = deleteWorkItem(item, snap, wiId, actor, role);
    if (res.ok) {
      append(item.id, res.event);
      pushToast({ ok: true, message: `Removed work item ${wiId}` });
    } else pushToast({ ok: false, message: res.error });
  }

  /* ---- which gate to surface ---- */
  const curSpine = STATES[snap.state] ? STATES[snap.state].spine ?? null : null;
  const showReadyGate = curSpine != null && curSpine <= 4;
  const showRelease = curSpine != null && curSpine >= 4;
  const offSpine = STATES[snap.state] && STATES[snap.state].lane === "off";

  function laneCount(f: string) {
    if (f === "all") return items.length;
    return items.filter((it) => {
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
        <div className="spacer"></div>
        <div className="roleswitch">
          {(["PM", "Dev"] as Role[]).map((r) => (
            <button key={r} data-role={r} data-on={role === r} onClick={() => setRole(r)}>
              <span className="dot"></span>{r === "PM" ? "Product" : "Engineering"}
            </button>
          ))}
        </div>
        <div className="who"><Avatar name={actor} /> <span>{actor}</span></div>
      </div>

      <div className="body">
        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="org-wrap">
            <button className="org-switch" onClick={() => setOrgOpen((o) => !o)}>
              <span className="org-glyph">{org[0]}</span>
              <span className="org-meta">
                <span className="org-name">{org}</span>
                <span className="org-sub">{seed.org.sub} · {items.length} items</span>
              </span>
              <span className="chev">▾</span>
            </button>
            {orgOpen && <>
              <div className="scrim" onClick={() => setOrgOpen(false)}></div>
              <div className="pop org-pop">
                <div className="ph">Organization</div>
                {seed.orgs.map((o) => (
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

        {/* DETAIL */}
        <main className="detail">
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
                  onCreate={addWorkItem} onUpdate={editWorkItem} onDelete={removeWorkItem} />
                <History item={item} />
                <Analytics item={item} />
              </div>
            </div>
            <div className="foot-note">events are the single source of truth · current state, gates, flags &amp; analytics are all derived</div>
          </div>
        </main>
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
