"use client";

import { useState } from "react";
import type { Snapshot } from "@/lib/engine";
import { timeAgo } from "@/lib/format";
import { Avatar } from "./badges";

/* Item-level discussion thread — chronological fold of ITEM_COMMENT events
   (snap.comments, derived in deriveItem). Posting goes through the command
   path ({kind:"item_comment"}); actor/role come from the session server-side. */
export function ItemComments({ snap, onComment }: { snap: Snapshot; onComment: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  const comments = snap.comments;

  function post() {
    const body = draft.trim();
    if (!body) return;
    onComment(body);
    setDraft("");
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3>Comments <span className="wi-cc">{comments.length}</span></h3>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>append-only · derived from events</span>
      </div>
      <div className="card-b">
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
          <textarea value={draft} maxLength={2000} rows={2}
            placeholder="Add a comment…  (⌘/Ctrl+Enter to post)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } }} />
          <button className="act primary" onClick={post} disabled={!draft.trim()}>Post</button>
        </div>
      </div>
    </div>
  );
}
