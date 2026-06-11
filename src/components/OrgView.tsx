"use client";

import { useState } from "react";
import type { Item } from "@/lib/engine";
import type { AnnouncementInfo, OrgInfo, ProjectInfo, TeamInfo } from "@/lib/api";
import { Avatar } from "./badges";
import { RecentWork } from "./RecentWork";
import { Announcements } from "./Announcements";

/* ---------------- ORG VIEW (detail pane) ----------------
   Master-detail with the sidebar tree: the Navigator lists orgs (mine first,
   all searchable); this pane renders ONE selected org — its teams, org-scoped
   announcements and recent work. Non-member orgs show a summary + privacy note
   (their teams are scoped out of `teams` server-side, so nothing can leak). */

function TeamCard({ team, projById, onSelectTeam }:
  { team: TeamInfo; projById: Record<string, ProjectInfo>; onSelectTeam: (id: string) => void }) {
  const owned = team.projectIds.map((id) => projById[id]).filter(Boolean) as ProjectInfo[];
  return (
    <div className="org-card" key={team.id}>
      <button className="org-card-h org-card-link" onClick={() => onSelectTeam(team.id)} title={`Open ${team.name} team space`}>
        <span className="nav-teamglyph">{team.name[0]}</span>
        <span className="org-card-name">{team.name}</span>
        <span className="nav-count mono">{team.members.length}</span>
      </button>
      <div className="org-sec">
        <div className="org-sec-l">Members</div>
        <div className="org-members">
          {team.members.map((m) => (
            <span className="org-member" key={m.id} title={`${m.name} · ${m.role}`}>
              <Avatar name={m.name} size={20} />
              <span className="om-name">{m.name}</span>
              <span className="kpill" data-role={m.role}>{m.role}</span>
            </span>
          ))}
          {!team.members.length && <span className="nav-empty">No members.</span>}
        </div>
      </div>
      <div className="org-sec">
        <div className="org-sec-l">Owns projects</div>
        <div className="org-projects">
          {owned.map((p) => (
            <span className="org-projtag" key={p.id} title={p.name}>
              <span className="nav-pkey mono">{p.key}</span>
              <span className="op-name">{p.name}</span>
            </span>
          ))}
          {!owned.length && <span className="nav-empty">No projects.</span>}
        </div>
      </div>
    </div>
  );
}

export function OrgView({ meId, selOrgId, orgs, projects, teams, items, announcements, canManage, onDeleteAnn, onOpenWork, onSelectTeam, onRenameOrg, onDeleteOrg }:
  { meId: string; selOrgId: string | null; orgs: OrgInfo[]; projects: ProjectInfo[]; teams: TeamInfo[]; items: Item[];
    announcements: AnnouncementInfo[]; canManage: boolean; onDeleteAnn: (id: string) => void;
    onOpenWork: (itemId: string, wiId: string) => void; onSelectTeam: (teamId: string) => void;
    onRenameOrg: (orgId: string, name: string) => void; onDeleteOrg: (orgId: string) => void }) {
  const projById = Object.fromEntries(projects.map((p) => [p.id, p]));
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  // rename/delete UI state is keyed by org id so it resets when the selection changes
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);

  // resolve the selected org (or the "Unassigned" pseudo-org of orgless teams)
  const unassigned = teams.filter((t) => !t.orgId);
  const org = selOrgId === "__unassigned"
    ? { id: "__unassigned", name: "Unassigned", teamIds: unassigned.map((t) => t.id) } as OrgInfo
    : orgs.find((o) => o.id === selOrgId) ?? null;

  if (!org) {
    return (
      <main className="detail board-main">
        <div className="app-loading">Select an organization in the sidebar.</div>
      </main>
    );
  }

  const teamList = org.teamIds.map((tid) => teamById[tid]).filter(Boolean) as TeamInfo[];
  const isMember = teamList.some((t) => t.members.some((m) => m.id === meId));
  // teams hidden by scope (non-member org for a non-admin) → restricted detail
  const restricted = !isMember && teamList.length < org.teamIds.length;

  const projIds = new Set<string>();
  teamList.forEach((t) => t.projectIds.forEach((p) => projIds.add(p)));
  const projs = [...projIds].map((id) => projById[id]).filter(Boolean) as ProjectInfo[];
  const memberCount = new Set(teamList.flatMap((t) => t.members.map((m) => m.id))).size;
  const orgItems = items.filter((it) => it.project && projIds.has(it.project));
  const orgAnn = announcements.filter((a) => a.scopeType === "org" && a.scopeId === org.id);

  return (
    <main className="detail board-main">
      <div className="company-wrap">
        <div className="ov-head">
          <div>
            {editingId === org.id
              ? <div className="org-rename">
                  <input className="org-rename-input" value={draft} maxLength={128} autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && draft.trim().length >= 2) { onRenameOrg(org.id, draft.trim()); setEditingId(null); }
                      if (e.key === "Escape") setEditingId(null);
                    }} />
                  <button className="wi-act" disabled={draft.trim().length < 2}
                    onClick={() => { onRenameOrg(org.id, draft.trim()); setEditingId(null); }}>Save</button>
                  <button className="wi-act" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              : <h1 className="ov-title">{org.name} {isMember && <span className="org-mine-badge">Member</span>}</h1>}
            <div className="ov-sub mono">
              {restricted
                ? `${org.teamIds.length} teams`
                : `${org.teamIds.length} teams · ${projs.length} projects · ${memberCount} people`}
            </div>
          </div>
          {!restricted && projs.length > 0 && (
            <span className="org-section-projs">
              {projs.map((p) => <span key={p.id} className="nav-pkey mono" title={p.name}>{p.key}</span>)}
            </span>
          )}
          {canManage && org.id !== "__unassigned" && editingId !== org.id && (
            <div className="org-admin-acts">
              <button className="wi-act" title="Rename organization"
                onClick={() => { setDraft(org.name); setEditingId(org.id); setConfirmDelId(null); }}>✎ Rename</button>
              {confirmDelId === org.id
                ? <>
                    <button className="wi-act org-del-confirm" onClick={() => { setConfirmDelId(null); onDeleteOrg(org.id); }}>
                      Confirm delete — teams become unassigned
                    </button>
                    <button className="wi-act" onClick={() => setConfirmDelId(null)}>Cancel</button>
                  </>
                : <button className="wi-act" title="Delete organization" onClick={() => setConfirmDelId(org.id)}>🗑 Delete</button>}
            </div>
          )}
        </div>

        {restricted
          ? <div className="nav-empty">You’re not a member of this organization — its teams and work aren’t visible to you.</div>
          : <>
              {orgAnn.length > 0 &&
                <Announcements items={orgAnn} canManage={canManage} onDelete={onDeleteAnn} title={`Announcements · ${org.name}`} />}
              <div className="org-grid">
                {teamList.map((t) => <TeamCard key={t.id} team={t} projById={projById} onSelectTeam={onSelectTeam} />)}
                {!teamList.length && <div className="nav-empty">No teams.</div>}
              </div>
              {orgItems.length > 0 &&
                <RecentWork items={orgItems} onOpen={onOpenWork} limit={6} title={`Recent work · ${org.name}`} />}
            </>}
      </div>
    </main>
  );
}
