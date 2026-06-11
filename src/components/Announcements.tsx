"use client";

import type { AnnouncementInfo } from "@/lib/api";
import { timeAgo } from "@/lib/format";

/* ---------------- ANNOUNCEMENTS ----------------
   Shared panel for Dashboard / Org / Team. Each row shows its scope level,
   title, body, author and age. Admins (canManage) get a delete control. */

const SCOPE_LABEL: Record<AnnouncementInfo["scopeType"], string> = {
  company: "Company", org: "Org", team: "Team",
};

export function Announcements({ items, canManage = false, onDelete, title = "Announcements", resolveName }:
  { items: AnnouncementInfo[]; canManage?: boolean; onDelete?: (id: string) => void;
    title?: string; resolveName?: (a: AnnouncementInfo) => string | null }) {
  return (
    <div className="card">
      <div className="card-h"><h3>📣 {title}</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{items.length}</span></div>
      <div className="card-b">
        <div className="ann-list">
          {items.map((a) => {
            const name = resolveName?.(a);
            return (
              <div className="ann-row" key={a.id}>
                <span className={"ann-badge ann-" + a.scopeType}>{SCOPE_LABEL[a.scopeType]}{name ? " · " + name : ""}</span>
                <div className="ann-main">
                  <div className="ann-title">{a.title}</div>
                  {a.body && <div className="ann-body">{a.body}</div>}
                  <div className="ann-meta mono">{a.author} · {timeAgo(new Date(a.createdAt).getTime())}</div>
                </div>
                {canManage && onDelete &&
                  <button className="ann-del" title="Delete announcement" onClick={() => onDelete(a.id)}>×</button>}
              </div>
            );
          })}
          {!items.length && <div className="nav-empty">No announcements.</div>}
        </div>
      </div>
    </div>
  );
}
