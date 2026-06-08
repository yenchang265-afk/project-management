/* =========================================================================
   APP — composition, role-driven dispatch, event mutation, tweaks.
   ========================================================================= */
var P = window.PDLC;
var CURRENT_USER = { PM: "Maya Chen", Dev: "Sam Okafor" };

var TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#5b5fd6",
  "density": "regular",
  "dark": false
} /*EDITMODE-END*/;

const LANE_FILTERS = [
{ key: "all", label: "All" },
{ key: "discovery", label: "Discovery" },
{ key: "build", label: "Build" },
{ key: "verify", label: "Verify" },
{ key: "release", label: "Release" },
{ key: "closed", label: "Closed" }];


function rejDetail(r) {
  const d = r.detail || {};
  switch (r.type) {
    case "GATE_CONDITIONS_UNSATISFIED":return "unsatisfied → " + d.conditions.join(", ");
    case "GATE_SIGNOFF_MISSING":return "missing → " + d.missing.join(" + ");
    case "ROLE_GUARD":return "your role: " + d.actorRole + " · needs: " + d.required.join(" or ");
    case "ILLEGAL_TRANSITION":return d.from + " ✗→ " + d.to;
    case "REASON_REQUIRED":return "allowed → " + d.allowed.join(", ");
    default:return null;
  }
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [items, setItems] = useState(() => window.PDLC_SEED.ITEMS.map((it) => ({ ...it, events: it.events.slice() })));
  const [role, setRole] = useState("PM");
  const [selId, setSelId] = useState("PAY-412");
  const [filter, setFilter] = useState("all");
  const [toasts, setToasts] = useState([]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [org, setOrg] = useState(window.PDLC_SEED.org.name);
  const [orgOpen, setOrgOpen] = useState(false);
  const GROUPS = window.PDLC_SEED.groups;
  function toggleNode(k) {
    setCollapsed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  // apply tweaks to <html>
  useLayoutEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", t.dark ? "dark" : "light");
    r.setAttribute("data-density", t.density);
    r.style.setProperty("--accent", t.accent);
  }, [t]);

  const actor = CURRENT_USER[role];
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const item = byId[selId];
  const snap = P.deriveItem(item);

  function pushToast(o) {
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 5);
    setToasts((ts) => [...ts, { id, ...o }]);
  }
  function dismiss(id) {setToasts((ts) => ts.filter((x) => x.id !== id));}

  function append(itemId, event) {
    setItems((its) => its.map((it) => it.id === itemId ? { ...it, events: [...it.events, event] } : it));
  }

  /* ---- transition engine bridge ---- */
  function doTransition(def, reason) {
    const res = P.applyTransition(item, def.to, actor, role, reason);
    if (res.ok) {
      append(item.id, res.event);
      pushToast({ ok: true, message: `${def.label} — now ${P.label(def.to)}`, detail: `${P.label(def.from)} → ${P.label(def.to)}` });
    } else {
      pushToast({ ok: false, type: res.rejection.type, message: res.rejection.message, detail: rejDetail(res.rejection) });
    }
  }

  /* ---- condition / gate / subtrack / flag dispatch (role-guarded) ---- */
  function guard(neededRole, what) {
    if (role !== neededRole) {
      pushToast({ ok: false, type: "ROLE_GUARD", message: `Only ${neededRole} can ${what}.`, detail: `your role: ${role}` });
      return false;
    }
    return true;
  }
  function satisfyCond(key) {
    const c = findCond(key);
    if (!guard(c.owner, `satisfy ${key}`)) return;
    append(item.id, P.ev(item.id, "CONDITION_SATISFY", actor, role, { condition: key }));
  }
  function waiveCond(key) {
    const c = findCond(key);
    if (!guard(c.owner, `waive ${key}`)) return;
    append(item.id, P.ev(item.id, "CONDITION_WAIVE", actor, role, { condition: key }));
  }
  function signoff(gate, slot) {
    if (!guard(slot, `sign the ${slot} slot`)) return;
    append(item.id, P.ev(item.id, "GATE_SIGNOFF", actor, role, { gate }));
  }
  function shiftLeft(risk, value) {
    if (!guard("PM", "set risk flags")) return;
    append(item.id, P.ev(item.id, "SHIFT_LEFT_SET", actor, role, { risk, value }));
  }
  function subtrack(track, to) {
    const owner = track === "security" ? "Dev" : "PM";
    if (!guard(owner, `advance the ${track} review`)) return;
    append(item.id, P.ev(item.id, "SUBTRACK", actor, role, { track, to }));
  }
  function toggleFlag(flag) {
    const on = !!snap.flags[flag];
    const reason = on ? null : flag === "blocked" ? "Flagged blocked" : "Put on hold";
    append(item.id, P.ev(item.id, "FLAG_SET", actor, role, { flag, value: !on, reason }));
  }
  function findCond(key) {
    for (const g of Object.values(P.GATES)) {const c = g.conditions.find((x) => x.key === key);if (c) return c;}
    return { owner: "PM" };
  }

  /* ---- iteration loop: spawn a linked child ---- */
  function spawnIteration() {
    if (!guard("PM", "spawn the next iteration")) return;
    const prefix = item.id.split("-")[0];
    const childId = prefix + "-" + (500 + Math.floor(Math.random() * 480));
    const child = {
      id: childId, title: item.title.replace(/\s*\(iteration.*\)$/i, "") + " (next iteration)",
      area: item.area, priority: "Medium", parent: item.id, type: "feature", workItems: [],
      stakeholders: [
        { role: "Product Manager", name: CURRENT_USER.PM },
        { role: "Engineering Manager", name: "Marcus Lin" },
        { role: "Tech Lead", name: CURRENT_USER.Dev },
        { role: "Designer", name: "Lena Petrova" },
      ],
      events: [P.ev(childId, "CREATE", actor, role, { to: "backlog" })]
    };
    setItems((its) => [
    ...its.map((it) => it.id === item.id ? { ...it, events: [...it.events, P.ev(item.id, "SPAWN_CHILD", actor, role, { child: childId })] } : it),
    child]
    );
    setSelId(childId);
    pushToast({ ok: true, message: `Spawned iteration ${childId}`, detail: `parent → ${item.id}` });
  }

  /* ---- which gate to surface ---- */
  const curSpine = P.STATES[snap.state] ? P.STATES[snap.state].spine : null;
  const showReadyGate = curSpine != null && curSpine <= 4;
  const showRelease = curSpine != null && curSpine >= 4;
  const offSpine = P.STATES[snap.state] && P.STATES[snap.state].lane === "off";

  /* ---- sidebar list ---- */
  const list = items.filter((it) => {
    if (filter === "all") return true;
    const lane = P.STATES[P.deriveItem(it).state].lane;
    if (filter === "closed") return lane === "closed" || lane === "off";
    return lane === filter;
  });
  function laneCount(f) {
    if (f === "all") return items.length;
    return items.filter((it) => {
      const lane = P.STATES[P.deriveItem(it).state].lane;
      return f === "closed" ? lane === "closed" || lane === "off" : lane === f;
    }).length;
  }

  const child = items.filter((i) => i.parent === item.id);

  return (
    <div className="app">
      {/* TOP BAR */}
      <div className="topbar" data-comment-anchor="3d7a517f45-div-161-7">
        <div className="brand">
          <span className="glyph">C</span>
          <span>Cadence</span>
        </div>
        <div className="spacer"></div>
        <div className="roleswitch">
          {["PM", "Dev"].map((r) =>
          <button key={r} data-role={r} data-on={role === r} onClick={() => setRole(r)}>
              <span className="dot"></span>{r === "PM" ? "Product" : "Engineering"}
            </button>
          )}
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
                <span className="org-sub">{window.PDLC_SEED.org.sub} · {items.length} items</span>
              </span>
              <span className="chev">▾</span>
            </button>
            {orgOpen && <>
              <div className="scrim" onClick={() => setOrgOpen(false)}></div>
              <div className="pop org-pop">
                <div className="ph">Organization</div>
                {window.PDLC_SEED.orgs.map((o) =>
                  <button key={o} onClick={() => { setOrg(o); setOrgOpen(false); }}>
                    <span className="org-glyph sm">{o[0]}</span>{o}
                    {o === org && <span style={{ marginLeft: "auto", color: "var(--ok)" }}>✓</span>}
                  </button>)}
              </div>
            </>}
          </div>
          <div className="side-head" data-comment-anchor="15f7ddc047-div-182-11">
            <div className="nav-search">
              <span className="ns-ic">⌕</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items…" />
              {query && <button className="ns-x" onClick={() => setQuery("")}>×</button>}
            </div>
            <div className="lanefilter">
              {LANE_FILTERS.map((f) =>
              <button key={f.key} data-on={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label} <span className="mono" style={{ opacity: .6 }}>{laneCount(f.key)}</span>
                </button>
              )}
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
              <span className="c">{(GROUPS.find((g) => g.teams.includes(item.area)) || {}).label || "—"}</span><span className="sep">›</span>
              <span className="c">{item.area}</span>
              {item.parent && byId[item.parent] &&
                <><span className="sep">›</span><button className="c link" onClick={() => setSelId(item.parent)}>{item.parent}</button></>}
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
                <button className="lineage" onClick={() => setSelId(item.parent)}>⎇ iteration of {item.parent}</button></>}
              {child.length > 0 && <><span className="metasep"></span>
                <button className="lineage" onClick={() => setSelId(child[0].id)}>⎇ {child.length} child {child.length > 1 ? "iterations" : "iteration"}</button></>}
              <div className="spacer"></div>
              <div className="flagbtns">
                {["blocked", "on_hold"].map((f) =>
                <button key={f} className={"flagbtn " + f} data-on={!!snap.flags[f]} onClick={() => toggleFlag(f)}>
                    {f === "blocked" ? "⚑" : "⏸"} {f === "blocked" ? "Blocked" : "On hold"}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="detail-scroll scroll">
            {snap.flags.blocked && <div className="banner blocked">⚑ <b>Blocked</b> — {snap.flags.blocked.reason}. Flag is orthogonal to state; the item stays in {P.label(snap.state)}.</div>}
            {snap.flags.on_hold && <div className="banner on_hold">⏸ <b>On hold</b> — {snap.flags.on_hold.reason}.</div>}

            <Spine snap={snap} data-comment-anchor="fe6f459c24-div-75-7" />

            <PlanVsActual item={item} />

            <div className="detail-grid">
              <div className="stack">
                <div className="card">
                  <div className="card-h">
                    <h3>Available actions</h3>
                    <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>as {role} · from {P.label(snap.state)}</span>
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
                <WorkItems item={item} />
                <History item={item} />
                <Analytics item={item} />
              </div>
            </div>
            <div className="foot-note">events are the single source of truth · current state, gates, flags &amp; analytics are all derived</div>
          </div>
        </main>
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />

      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakColor label="Accent" value={t.accent}
        options={["#5b5fd6", "#2f76d6", "#138a72", "#8456d8", "#b5532a"]}
        onChange={(v) => setTweak("accent", v)} />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak("dark", v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density} options={["compact", "regular", "comfy"]}
        onChange={(v) => setTweak("density", v)} />
      </TweaksPanel>
    </div>);

}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);