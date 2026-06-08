"use client";

import { SUBTRACK_FLOW, SUBTRACK_LABELS, type Role, type Snapshot, type SubtrackState, type TrackKey } from "@/lib/engine";

/* ---------------- SUB-TRACKS ---------------- */
interface SubTracksProps {
  snap: Snapshot;
  role: Role;
  onSubtrack: (track: TrackKey, to: SubtrackState) => void;
}

export function SubTracks({ snap, role, onSubtrack }: SubTracksProps) {
  const tracks: { key: TrackKey; label: string; owner: Role }[] = [
    { key: "security", label: "Security review", owner: "Dev" },
    { key: "compliance", label: "Compliance review", owner: "PM" },
  ];
  const flowKeys: SubtrackState[] = ["pending", "in_review", "changes_requested", "approved"];
  return (
    <div className="card">
      <div className="card-h">
        <h3>Parallel reviews</h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>concurrent · feeds release gate</span>
      </div>
      <div className="card-b stack" style={{ gap: 11 }}>
        {tracks.map((t) => {
          const cur = snap.subtracks[t.key];
          const next = SUBTRACK_FLOW[cur] || [];
          const owns = t.owner === role;
          const idx = flowKeys.indexOf(cur);
          return (
            <div className="subtrack" key={t.key}>
              <div className="st-h">
                <span className="st-name">
                  <span className="d" style={{ width: 7, height: 7, borderRadius: 2, background: cur === "approved" ? "var(--ok)" : "var(--accent)" }}></span>
                  {t.label}</span>
                <span className="cowner">{t.owner}</span>
              </div>
              <div className="st-flow">
                {flowKeys.filter((k) => k !== "changes_requested" || cur === "changes_requested").map((k, i, arr) => {
                  const ki = flowKeys.indexOf(k);
                  return (
                    <div className={"st-step " + (k === "approved" ? "approved" : "")} key={k}
                      data-on={idx >= ki} data-cur={cur === k} style={{ flex: i === arr.length - 1 ? "0 0 auto" : 1 }}>
                      <span className="sd"></span>
                      {i < arr.length - 1 && <span className="sl"></span>}
                    </div>
                  );
                })}
              </div>
              <div className="st-foot">
                <span className="st-state-lb" style={{ color: cur === "approved" ? "var(--ok)" : cur === "changes_requested" ? "var(--warn)" : "var(--text-2)" }}>
                  {SUBTRACK_LABELS[cur]}</span>
                <div className="st-acts">
                  {next.map((nx) => (
                    <button key={nx} disabled={!owns}
                      title={owns ? "" : `Only ${t.owner} can advance this review`}
                      onClick={() => onSubtrack(t.key, nx)}>
                      {nx === "approved" ? "Approve" : nx === "in_review" ? (cur === "pending" ? "Start review" : "Re-review") : "Request changes"}
                    </button>
                  ))}
                  {!next.length && <span className="mono" style={{ fontSize: 11, color: "var(--ok)" }}>✓ approved</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
