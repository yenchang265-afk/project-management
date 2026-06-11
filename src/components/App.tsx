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
  type FlagKey, type GateKey, type Item, type ItemLinkKind, type PdlcEvent, type Rejection, type Role,
  type SubtrackState, type TrackKey, type TransitionDef, type WiLinkType, type WiState, type WiType, type WorkItem,
} from "@/lib/engine";
import {
  assignItemProject, bulkCommands, createAnnouncement, createOrg, createProject, createTeam, deleteAnnouncement, deleteOrg,
  fetchAnnouncements, fetchItems, fetchMe, fetchNotifications, fetchStructure, fetchUsers,
  logout, markNotificationsRead, postCommand, postSpawn, renameOrg, searchAll, setTeamOrg, teamMemberOp, teamProjectOp,
  type AnnouncementInfo, type AnnouncementScope, type ApiUser, type NotificationInfo, type Structure, type TeamMemberInfo,
} from "@/lib/api";
import type { SearchHit } from "@/lib/search";
import { timeAgo } from "@/lib/format";
import { Avatar, StateBadge, TypeBox, WI_TYPES } from "./badges";
import { Actions } from "./Actions";
import { Analytics } from "./Analytics";
import { Board } from "./Board";
import { DashboardView } from "./DashboardView";
import { OrgView } from "./OrgView";
import { GateInspector } from "./GateInspector";
import { History } from "./History";
import { ItemComments } from "./ItemComments";
import { ItemLinks } from "./ItemLinks";
import { Navigator } from "./Navigator";
import { PlanVsActual } from "./PlanVsActual";
import { RequirementDocs } from "./docs";
import { Spine } from "./Spine";
import { Stakeholders } from "./Stakeholders";
import { SubTracks } from "./SubTracks";
import { TeamSpace } from "./TeamSpace";
import { Toasts, type Toast } from "./Toasts";
import { WorkItems } from "./WorkItems";
import { WorkItemDrawer } from "./WorkItemDrawer";

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
  const [structure, setStructure] = useState<Structure | null>(null);
  const [users, setUsers] = useState<TeamMemberInfo[]>([]);
  const [adminModal, setAdminModal] = useState<"project" | "team" | "org" | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementInfo[]>([]);
  const [notifications, setNotifications] = useState<NotificationInfo[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [annModal, setAnnModal] = useState(false);
  const [annScope, setAnnScope] = useState<AnnouncementScope>("company");
  const [annTarget, setAnnTarget] = useState("");
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selId, setSelId] = useState("PAY-412");
  const [selTeamId, setSelTeamId] = useState<string | null>(null);
  const [selOrgId, setSelOrgId] = useState<string | null>(null);
  // top-level workspace, each isolated: Dashboard (default landing) · Organization (orgs+teams) · Projects.
  const [mode, setMode] = useState<"dashboard" | "org" | "projects">("dashboard");
  const [view, setView] = useState<"detail" | "board">("detail");
  const [openWiId, setOpenWiId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [query, setQuery] = useState("");
  // "Search everything" — server-side hits complementing the local Navigator filter.
  // null = dropdown closed (query too short / cleared); [] = searched, no matches.
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
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
      const [itemsRes, structRes, usersRes, annRes] = await Promise.all([fetchItems(), fetchStructure(), fetchUsers(), fetchAnnouncements()]);
      if (!itemsRes.ok) { setLoadError(itemsRes.error); return; }
      if (!structRes.ok) { setLoadError(structRes.error); return; }
      setItems(itemsRes.data.items);
      setStructure(structRes.data);
      if (usersRes.ok) setUsers(usersRes.data.users);
      if (annRes.ok) setAnnouncements(annRes.data.announcements);
      setVersions(itemsRes.data.versions);
      versionsRef.current = { ...itemsRes.data.versions };
      if (!itemsRes.data.items.some((i) => i.id === "PAY-412") && itemsRes.data.items[0])
        setSelId(itemsRes.data.items[0].id);
    })();
  }, []);

  // notifications: fetch on login, then poll every 30s (cleaned up on unmount)
  useEffect(() => {
    if (!me) return;
    let live = true;
    const load = async () => {
      const r = await fetchNotifications();
      if (live && r.ok) setNotifications(r.data.notifications);
    };
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => { live = false; clearInterval(t); };
  }, [me]);

  // server search: debounce 300ms, only for queries of 2+ chars; stale responses are dropped
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setSearchHits(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchAll(q);
      if (live && r.ok) setSearchHits(r.data.results);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  function pushToast(o: Omit<Toast, "id">) {
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 5);
    setToasts((ts) => [...ts, { id, ...o }]);
  }
  function dismiss(id: string) { setToasts((ts) => ts.filter((x) => x.id !== id)); }

  if (loadError) return <div className="app-loading error">⚠ {loadError}</div>;
  if (!me || !items || !structure) return <div className="app-loading">Loading Cadence…</div>;

  const role: Role = me.role;
  const actor = me.name;
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const item = byId[selId] || items[0];
  if (!item) return <div className="app-loading">No items yet.</div>;
  const snap = deriveItem(item);
  const selTeam = structure.teams.find((t) => t.id === selTeamId) || null;
  const itemProject = structure.projects.find((p) => p.id === item.project) || null;

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
  function commentOnItem(text: string) {
    void sendCmd(item.id, { kind: "item_comment", text });
  }
  function linkItem(to: string, linkKind: ItemLinkKind) {
    void sendCmd(item.id, { kind: "item_link", to, linkKind });
  }
  function unlinkItem(to: string, linkKind: ItemLinkKind) {
    void sendCmd(item.id, { kind: "item_unlink", to, linkKind });
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
  /* ---- bulk edit: one wiUpdate per selected WI in a single request.
     Ops apply sequentially server-side, so expectedVersion climbs per op;
     after the response we refetch (the existing reload path) to reconcile. ---- */
  async function bulkEditWis(wiIds: string[], patch: Record<string, unknown>) {
    if (!wiIds.length) return;
    const itemId = item.id;
    const base = versionsRef.current[itemId] ?? item.events.length;
    const r = await bulkCommands(wiIds.map((wiId, i) => ({
      itemId, expectedVersion: base + i, command: { kind: "wiUpdate", wiId, patch },
    })));
    await refreshItems(); // reconcile regardless of per-op outcomes
    if (!r.ok) { pushToast({ ok: false, message: r.error }); return; }
    const okN = r.data.results.filter((x) => x.status === "ok").length;
    if (okN === wiIds.length)
      pushToast({ ok: true, message: `Updated ${okN} work item${okN === 1 ? "" : "s"}` });
    else
      pushToast({ ok: false, message: `Bulk edit: ${okN}/${wiIds.length} applied — view refreshed, try the rest again.` });
  }
  function openFromBoard(itemId: string, wiId: string) {
    setSelId(itemId);
    setOpenWiId(wiId);
  }
  function selectItem(id: string) {
    setSelId(id);
    setMode("projects");
    setView("detail");
  }
  // "Search everything" result → jump to the item (and open the WI drawer if the hit is a work item)
  function openSearchHit(h: SearchHit) {
    selectItem(h.itemId);
    setOpenWiId(h.wiId ?? null);
    setQuery("");          // clears the input + closes the dropdown
    setSearchHits(null);
  }
  // selecting a team opens its TeamSpace inside the Organization workspace
  function selectTeam(teamId: string) {
    const t = structure?.teams.find((x) => x.id === teamId);
    setSelOrgId(t?.orgId ?? "__unassigned");
    setSelTeamId(teamId);
    setMode("org");
  }
  function selectOrg(orgId: string) {
    setSelOrgId(orgId);
    setSelTeamId(null); // org node selected — leave the team space
    setMode("org");
  }
  // default org selection = first org I belong to (fall back to first org)
  function enterOrgMode() {
    setMode("org");
    if (!selOrgId && structure) {
      const myOrg = structure.teams.find((t) => t.orgId && t.members.some((m) => m.id === me!.id))?.orgId;
      setSelOrgId(myOrg ?? structure.orgs[0]?.id ?? null);
    }
  }

  /* ---- Phase 3 admin (server enforces PM; client guard is UX only) ---- */
  const isPM = role === "PM";
  async function refreshStructure() {
    const r = await fetchStructure();
    if (r.ok) setStructure(r.data);
  }
  async function refreshItems() {
    const r = await fetchItems();
    if (r.ok) {
      setItems(r.data.items);
      setVersions(r.data.versions);
      versionsRef.current = { ...r.data.versions };
    }
  }
  function openAdminModal(kind: "project" | "team" | "org") {
    setDraftName(""); setDraftKey(""); setDraftDesc("");
    setNewMenuOpen(false);
    setAdminModal(kind);
  }
  async function submitAdminModal() {
    const name = draftName.trim();
    if (!name) return;
    const res = adminModal === "project"
      ? await createProject(draftKey.trim().toUpperCase(), name, draftDesc.trim() || null)
      : adminModal === "org"
      ? await createOrg(name)
      : await createTeam(name);
    if (res.ok) {
      await refreshStructure();
      pushToast({ ok: true, message: `Created ${adminModal} “${name}”` });
      setAdminModal(null);
    } else {
      pushToast({ ok: false, message: res.error });
    }
  }
  async function memberOp(teamId: string, userId: string, op: "add" | "remove") {
    const r = await teamMemberOp(teamId, userId, op);
    if (r.ok) await refreshStructure();
    else pushToast({ ok: false, message: r.error });
  }
  async function projectOp(teamId: string, projectId: string, op: "add" | "remove") {
    const r = await teamProjectOp(teamId, projectId, op);
    if (r.ok) await refreshStructure();
    else pushToast({ ok: false, message: r.error });
  }
  async function teamOrgOp(teamId: string, orgId: string | null) {
    const r = await setTeamOrg(teamId, orgId);
    if (r.ok) await refreshStructure();
    else pushToast({ ok: false, message: r.error });
  }
  async function orgRename(orgId: string, name: string) {
    const r = await renameOrg(orgId, name);
    if (r.ok) { await refreshStructure(); pushToast({ ok: true, message: "Organization renamed" }); }
    else pushToast({ ok: false, message: r.error });
  }
  async function orgDelete(orgId: string) {
    const r = await deleteOrg(orgId);
    if (r.ok) {
      await Promise.all([refreshStructure(), refreshAnnouncements()]);
      setSelOrgId(null); // deleted org was selected — drop back to the picker state
      pushToast({ ok: true, message: "Organization deleted — its teams are now unassigned" });
    } else pushToast({ ok: false, message: r.error });
  }
  async function refreshAnnouncements() {
    const r = await fetchAnnouncements();
    if (r.ok) setAnnouncements(r.data.announcements);
  }
  function openAnnModal() {
    setAnnScope("company"); setAnnTarget(""); setAnnTitle(""); setAnnBody("");
    setNewMenuOpen(false); setAnnModal(true);
  }
  async function submitAnnouncement() {
    const title = annTitle.trim();
    if (!title) return;
    if (annScope !== "company" && !annTarget) { pushToast({ ok: false, message: "Pick a target." }); return; }
    const r = await createAnnouncement(annScope, annScope === "company" ? null : annTarget, title, annBody.trim() || null);
    if (r.ok) {
      await refreshAnnouncements();
      pushToast({ ok: true, message: "Announcement posted" });
      setAnnModal(false);
    } else pushToast({ ok: false, message: r.error });
  }
  async function removeAnnouncement(id: string) {
    const r = await deleteAnnouncement(id);
    if (r.ok) await refreshAnnouncements();
    else pushToast({ ok: false, message: r.error });
  }
  // resolve an announcement's target name for display (org/team)
  function annName(a: AnnouncementInfo): string | null {
    if (a.scopeType === "org") return structure?.orgs.find((o) => o.id === a.scopeId)?.name ?? null;
    if (a.scopeType === "team") return structure?.teams.find((t) => t.id === a.scopeId)?.name ?? null;
    return null;
  }
  async function assignProject(itemId: string, projectId: string | null) {
    const r = await assignItemProject(itemId, projectId);
    if (r.ok) {
      await refreshItems();
      pushToast({ ok: true, message: projectId ? "Item moved to project" : "Item removed from project" });
    } else {
      pushToast({ ok: false, message: r.error });
    }
  }

  /* ---- notifications: bell dropdown + watch toggle ---- */
  const unreadCount = notifications.filter((n) => !n.readAt).length;
  const watching = snap.watchers.has(actor);
  function markReadLocal(ids: string[] | "all") {
    const now = new Date().toISOString();
    setNotifications((ns) => ns.map((n) =>
      !n.readAt && (ids === "all" || ids.includes(n.id)) ? { ...n, readAt: now } : n));
  }
  async function openNotification(n: NotificationInfo) {
    setBellOpen(false);
    if (n.itemId && byId[n.itemId]) selectItem(n.itemId);
    if (!n.readAt) {
      markReadLocal([n.id]); // optimistic — server is source of truth on next poll
      await markNotificationsRead([n.id]);
    }
  }
  async function markAllRead() {
    markReadLocal("all");
    await markNotificationsRead();
  }
  function toggleWatch() {
    void sendCmd(item.id, { kind: "watch", on: !watching },
      { ok: true, message: watching ? `Stopped watching ${item.id}` : `Watching ${item.id}`, detail: "you'll be notified of moves & comments" });
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
        <div className="modeswitch">
          <button data-on={mode === "dashboard"} onClick={() => setMode("dashboard")}>⬡ Dashboard</button>
          <button data-on={mode === "org"} onClick={enterOrgMode}>⤜ Organization</button>
          <button data-on={mode === "projects"} onClick={() => setMode("projects")}>▤ Projects</button>
        </div>
        {mode === "projects" &&
          <div className="viewswitch">
            {(["detail", "board"] as const).map((v) => (
              <button key={v} data-on={view === v} onClick={() => setView(v)}>
                {v === "detail" ? "▤ Details" : "▦ Board"}
              </button>
            ))}
          </div>}
        <div className="spacer"></div>
        {isPM &&
          <div className="newmenu">
            <button className="newmenu-btn" data-open={newMenuOpen}
              onClick={() => setNewMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={newMenuOpen}>
              ＋ New <span className="newmenu-caret">▾</span>
            </button>
            {newMenuOpen && <>
              <div className="newmenu-scrim" onClick={() => setNewMenuOpen(false)}></div>
              <div className="newmenu-pop" role="menu">
                <button role="menuitem" onClick={openAnnModal}>
                  <span className="nm-ic mono">📣</span> Announcement
                </button>
                <button role="menuitem" onClick={() => openAdminModal("org")}>
                  <span className="nm-ic mono">⤜</span> Organization
                </button>
                <button role="menuitem" onClick={() => openAdminModal("project")}>
                  <span className="nm-ic mono">▤</span> Project
                </button>
                <button role="menuitem" onClick={() => openAdminModal("team")}>
                  <span className="nm-ic mono">◴</span> Team
                </button>
              </div>
            </>}
          </div>}
        <div className="bellwrap">
          <button className="bell-btn" title="Notifications" aria-haspopup="menu" aria-expanded={bellOpen}
            onClick={() => setBellOpen((o) => !o)}>
            🔔{unreadCount > 0 && <span className="bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
          </button>
          {bellOpen && <>
            <div className="newmenu-scrim" onClick={() => setBellOpen(false)}></div>
            <div className="bell-pop" role="menu">
              <div className="bell-head">
                <b>Notifications</b>
                {unreadCount > 0 && <button className="bell-markall" onClick={markAllRead}>Mark all read</button>}
              </div>
              {notifications.length === 0 &&
                <div className="bell-empty">No notifications yet — watch an item to get updates.</div>}
              {notifications.map((n) => (
                <button key={n.id} className="bell-row" data-unread={!n.readAt} role="menuitem"
                  onClick={() => void openNotification(n)}>
                  <span className="bell-dot" aria-hidden="true"></span>
                  <span className="bell-msg">{n.message}</span>
                  <span className="bell-ts mono">{timeAgo(new Date(n.createdAt).getTime())}</span>
                </button>
              ))}
            </div>
          </>}
        </div>
        <div className="who">
          <Avatar name={actor} /> <span>{actor}</span>
          <span className="kpill" data-role={role}>{role === "PM" ? "Product" : "Engineering"}</span>
          <button className="wi-act logout" title="Sign out" onClick={doLogout}>⎋</button>
        </div>
      </div>

      <div className="body">
        {/* SIDEBAR — organization/item workspaces have a nav rail (dashboard is full-width) */}
        {(mode === "projects" || mode === "org") &&
        <aside className="sidebar">
          <div className="org-wrap">
            <div className="org-switch" style={{ cursor: "default" }}>
              <span className="org-glyph">C</span>
              <span className="org-meta">
                <span className="org-name">Cadence</span>
                <span className="org-sub">{structure.projects.length} projects · {structure.teams.length} teams · {items.length} items</span>
              </span>
            </div>
          </div>
          <div className="side-head">
            <div className="nav-search">
              <span className="ns-ic">⌕</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={mode === "org" ? "Search all orgs…" : "Search items…"} />
              {query && <button className="ns-x" onClick={() => setQuery("")}>×</button>}
            </div>
            {/* server-side "Search everything" — complements the local tree filter above */}
            {searchHits !== null &&
              <div className="search-pop" role="listbox" aria-label="Search everything">
                <div className="search-pop-head">Search everything</div>
                {searchHits.length === 0 &&
                  <div className="search-pop-empty">No matches across your items.</div>}
                {searchHits.map((h, i) => (
                  <button key={h.itemId + ":" + (h.wiId ?? "") + ":" + i} className="search-hit" role="option"
                    onClick={() => openSearchHit(h)}>
                    <span className="sh-id mono">{h.wiId ?? h.itemId}</span>
                    <span className="sh-title">{h.wiId ? h.wiTitle : h.title}</span>
                    {h.wiId && <span className="sh-in">in {h.itemId}</span>}
                    <span className="sh-field mono">{h.field === "wi_title" ? "title" : h.field.replace("wi_", "")}</span>
                  </button>
                ))}
              </div>}
            {mode === "projects" && <div className="lanefilter">
              {LANE_FILTERS.map((f) => (
                <button key={f.key} data-on={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label} <span className="mono" style={{ opacity: 0.6 }}>{laneCount(f.key)}</span>
                </button>
              ))}
            </div>}
          </div>
          <div className="itemtree scroll">
            <Navigator mode={mode} meId={me.id} orgs={structure.orgs} projects={structure.projects} teams={structure.teams} items={items}
              selId={selId} selTeamId={mode === "org" ? selTeamId : null} selOrgId={mode === "org" ? selOrgId : null}
              onSelect={selectItem} onSelectTeam={selectTeam} onSelectOrg={selectOrg}
              filter={filter} search={query} collapsed={collapsed} onToggle={toggleNode} />
          </div>
        </aside>}

        {/* DASHBOARD — personalized default landing (admin sees full company rollup) */}
        {mode === "dashboard" &&
          <DashboardView me={me} orgs={structure.orgs} projects={structure.projects} teams={structure.teams}
            items={items} announcements={announcements} canManage={isPM}
            onDeleteAnn={removeAnnouncement} annName={annName}
            onSelectItem={selectItem} onOpenWork={openFromBoard} />}

        {/* ORGANIZATION — tree selects an org (org detail/management) or a team (full TeamSpace) */}
        {mode === "org" && selTeam &&
          <main className="detail board-main">
            <TeamSpace team={selTeam} orgs={structure.orgs} projects={structure.projects} items={items}
              users={users} canManage={isPM}
              onMove={moveWorkItemOn} onOpen={openFromBoard} onSelectItem={selectItem}
              onMemberOp={(u, op) => memberOp(selTeam.id, u, op)}
              onProjectOp={(p, op) => projectOp(selTeam.id, p, op)}
              onSetOrg={(orgId) => teamOrgOp(selTeam.id, orgId)}
              announcements={announcements.filter((a) => a.scopeType === "team" && a.scopeId === selTeam.id)}
              onDeleteAnn={removeAnnouncement} />
          </main>}
        {mode === "org" && !selTeam &&
          <OrgView meId={me.id} selOrgId={selOrgId} orgs={structure.orgs} projects={structure.projects} teams={structure.teams}
            items={items} announcements={announcements} canManage={isPM} onDeleteAnn={removeAnnouncement}
            onOpenWork={openFromBoard} onSelectTeam={selectTeam}
            onRenameOrg={orgRename} onDeleteOrg={orgDelete} />}

        {/* BOARD */}
        {mode === "projects" && view === "board" &&
          <main className="detail board-main">
            <Board items={items} onMove={moveWorkItemOn} onOpen={openFromBoard} />
          </main>}

        {/* DETAIL */}
        {mode === "projects" && view === "detail" && <main className="detail">
          <div className="detail-head">
            <div className="crumbs">
              <span className="c">{itemProject ? itemProject.name : "No project"}</span>
              <span className="sep">›</span>
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
              {isPM &&
                <select className="wi-sel proj-sel" title="Project" value={item.project ?? ""}
                  onChange={(e) => assignProject(item.id, e.target.value || null)}>
                  <option value="">No project</option>
                  {structure.projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
                </select>}
              {item.parent && <><span className="metasep"></span>
                <button className="lineage" onClick={() => setSelId(item.parent!)}>⎇ iteration of {item.parent}</button></>}
              {child.length > 0 && <><span className="metasep"></span>
                <button className="lineage" onClick={() => setSelId(child[0].id)}>⎇ {child.length} child {child.length > 1 ? "iterations" : "iteration"}</button></>}
              <div className="spacer"></div>
              <div className="flagbtns">
                <button className="flagbtn watch" data-on={watching} onClick={toggleWatch}
                  title={watching ? "Stop watching this item" : "Get notified about transitions and comments"}>
                  ◉ {watching ? "Watching" : "Watch"}
                </button>
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
                  teamIds={itemProject?.teamIds ?? []}
                  onCreate={addWorkItem} onUpdate={editWorkItem} onDelete={removeWorkItem} onOpen={setOpenWiId}
                  onMove={moveWorkItem} onReorder={rankWi} onBulkUpdate={(ids, patch) => void bulkEditWis(ids, patch)} />
                <ItemLinks item={item} snap={snap} all={items ?? []} onLink={linkItem} onUnlink={unlinkItem} />
                <ItemComments snap={snap} onComment={commentOnItem} />
                <History item={item} />
                <Analytics item={item} />
              </div>
            </div>
            <div className="foot-note">events are the single source of truth · current state, gates, flags &amp; analytics are all derived · persisted in MariaDB</div>
          </div>
        </main>}
      </div>

      {adminModal && <>
        <div className="wi-drawer-scrim" onClick={() => setAdminModal(null)}></div>
        <div className="admin-modal" role="dialog" aria-modal="true" aria-label={`New ${adminModal}`}>
          <h2>New {adminModal === "org" ? "organization" : adminModal}</h2>
          {adminModal === "project" &&
            <label className="wi-field block"><span>Key</span>
              <input value={draftKey} maxLength={8} placeholder="e.g. PAY" autoFocus
                onChange={(e) => setDraftKey(e.target.value.toUpperCase())} />
            </label>}
          <label className="wi-field block"><span>Name</span>
            <input value={draftName} maxLength={128}
              placeholder={adminModal === "project" ? "Project name" : adminModal === "org" ? "Organization name" : "Team name"}
              autoFocus={adminModal === "team" || adminModal === "org"}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitAdminModal(); if (e.key === "Escape") setAdminModal(null); }} />
          </label>
          {adminModal === "project" &&
            <label className="wi-field block"><span>Description</span>
              <textarea value={draftDesc} rows={2} maxLength={500} placeholder="Optional"
                onChange={(e) => setDraftDesc(e.target.value)} />
            </label>}
          <div className="admin-modal-foot">
            <button className="wi-act" onClick={() => setAdminModal(null)}>Cancel</button>
            <button className="act primary" onClick={submitAdminModal}
              disabled={!draftName.trim() || (adminModal === "project" && draftKey.trim().length < 2)}>Create</button>
          </div>
        </div>
      </>}

      {annModal && <>
        <div className="wi-drawer-scrim" onClick={() => setAnnModal(false)}></div>
        <div className="admin-modal" role="dialog" aria-modal="true" aria-label="New announcement">
          <h2>📣 New announcement</h2>
          <label className="wi-field block"><span>Scope</span>
            <select className="wi-sel" value={annScope}
              onChange={(e) => { setAnnScope(e.target.value as AnnouncementScope); setAnnTarget(""); }}>
              <option value="company">Company (everyone)</option>
              <option value="org">Organization</option>
              <option value="team">Team</option>
            </select>
          </label>
          {annScope === "org" &&
            <label className="wi-field block"><span>Organization</span>
              <select className="wi-sel" value={annTarget} onChange={(e) => setAnnTarget(e.target.value)}>
                <option value="">Pick an org…</option>
                {structure.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>}
          {annScope === "team" &&
            <label className="wi-field block"><span>Team</span>
              <select className="wi-sel" value={annTarget} onChange={(e) => setAnnTarget(e.target.value)}>
                <option value="">Pick a team…</option>
                {structure.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>}
          <label className="wi-field block"><span>Title</span>
            <input value={annTitle} maxLength={160} placeholder="Announcement title" autoFocus
              onChange={(e) => setAnnTitle(e.target.value)} />
          </label>
          <label className="wi-field block"><span>Message</span>
            <textarea value={annBody} rows={3} maxLength={2000} placeholder="Optional details"
              onChange={(e) => setAnnBody(e.target.value)} />
          </label>
          <div className="admin-modal-foot">
            <button className="wi-act" onClick={() => setAnnModal(false)}>Cancel</button>
            <button className="act primary" onClick={submitAnnouncement}
              disabled={!annTitle.trim() || (annScope !== "company" && !annTarget)}>Post</button>
          </div>
        </div>
      </>}

      {openWiId && snap.workItems.some((w) => w.id === openWiId) &&
        <WorkItemDrawer key={item.id + ":" + openWiId} item={item} snap={snap} wiId={openWiId} role={role}
          onClose={() => setOpenWiId(null)} onUpdate={editWorkItem} onComment={commentOnWorkItem}
          onMove={moveWorkItem} onLink={linkWi} onUnlink={unlinkWi} />}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
