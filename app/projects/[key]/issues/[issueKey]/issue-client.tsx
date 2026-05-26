'use client';

// Client-side interactivity for the issue detail page:
//   - status transition menu
//   - comment composer (plain textarea fallback for MVP)
//   - link form
//   - attachment dropzone (uses uploadToS3 helper)
//   - activity timeline (read-only, rendered server-side props)
//
// Tiptap is installed but not wired in: a plain <textarea> satisfies the MVP
// and keeps the client bundle small. Phase 4 can swap it in for the comment
// composer without changing the API contract.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { uploadToS3 } from '@/lib/uploadToS3';

type CommentVM = { id: string; authorId: string; body: string; createdAt: string };
type AttachmentVM = { id: string; filename: string; uploaderId: string; size: number };
type LinkVM = {
  id: string;
  type: string;
  direction: 'from' | 'to';
  fromIssueId: string;
  toIssueId: string;
};
type ActivityVM = {
  id: string;
  actorId: string;
  field: string;
  before: string | null;
  after: string | null;
  at: string;
};

const STATUS_TRANSITIONS: Record<string, string[]> = {
  TODO: ['IN_PROGRESS'],
  IN_PROGRESS: ['TODO', 'IN_REVIEW'],
  IN_REVIEW: ['TODO', 'IN_PROGRESS', 'DONE'],
  DONE: ['TODO'],
};

export function IssueClient(props: {
  issueKey: string;
  projectKey: string;
  status: string;
  canEdit: boolean;
  initialComments: CommentVM[];
  attachments: AttachmentVM[];
  links: LinkVM[];
  activity: ActivityVM[];
}) {
  const router = useRouter();
  const { issueKey, status, canEdit, attachments, links, activity } = props;
  const [comments, setComments] = useState(props.initialComments);
  const [commentBody, setCommentBody] = useState('');
  const [linkTo, setLinkTo] = useState('');
  const [linkType, setLinkType] = useState('BLOCKS');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function transition(to: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/issues/${issueKey}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message: string } };
        throw new Error(j.error?.message ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'transition failed');
    } finally {
      setBusy(false);
    }
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/issues/${issueKey}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: commentBody }),
      });
      const j = (await res.json()) as {
        comment?: CommentVM;
        error?: { message: string };
      };
      if (!res.ok || !j.comment) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
      setComments((prev) => [{ ...j.comment!, createdAt: new Date().toISOString() }, ...prev]);
      setCommentBody('');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'comment failed');
    } finally {
      setBusy(false);
    }
  }

  async function postLink(e: React.FormEvent) {
    e.preventDefault();
    if (!linkTo.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/issues/${issueKey}/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toKey: linkTo.trim(), type: linkType }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message: string } };
        throw new Error(j.error?.message ?? `HTTP ${res.status}`);
      }
      setLinkTo('');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'link failed');
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/issues/${issueKey}/attachments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
        }),
      });
      const j = (await res.json()) as {
        attachment?: AttachmentVM;
        uploadUrl?: string;
        error?: { message: string };
      };
      if (!res.ok || !j.uploadUrl || !j.attachment) {
        throw new Error(j.error?.message ?? `HTTP ${res.status}`);
      }
      await uploadToS3(file, j.uploadUrl);
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  return (
    <div className="space-y-6">
      {/* Transitions */}
      {canEdit ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase text-gray-600">Transition</h2>
          <div className="flex flex-wrap gap-2">
            {(STATUS_TRANSITIONS[status] ?? []).map((to) => (
              <button
                key={to}
                type="button"
                onClick={() => transition(to)}
                disabled={busy}
                data-testid={`transition-${to}`}
                className="rounded border bg-white px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                → {to}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {err ? (
        <p className="text-sm text-red-600" data-testid="issue-action-error">
          {err}
        </p>
      ) : null}

      {/* Comments */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-gray-600">Comments</h2>
        <ul className="space-y-2" data-testid="comments">
          {comments.map((c) => (
            <li key={c.id} className="rounded border bg-white p-3 text-sm">
              <div className="text-xs text-gray-500">
                {c.authorId} · {new Date(c.createdAt).toLocaleString()}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
        {canEdit ? (
          <form className="mt-2 space-y-2" onSubmit={postComment}>
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={3}
              placeholder="Comment (use @username to mention)…"
              className="w-full rounded border p-2 text-sm"
              data-testid="comment-body"
            />
            <button
              type="submit"
              disabled={busy}
              data-testid="comment-submit"
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Post comment
            </button>
          </form>
        ) : null}
      </section>

      {/* Attachments */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-gray-600">Attachments</h2>
        <ul className="space-y-1 text-sm">
          {attachments.map((a) => (
            <li key={a.id}>
              {a.filename}{' '}
              <span className="text-xs text-gray-500">({Math.round(a.size / 1024)} KB)</span>
            </li>
          ))}
        </ul>
        {canEdit ? (
          <label className="mt-2 inline-block cursor-pointer rounded border px-3 py-1 text-sm">
            Upload file
            <input type="file" className="hidden" onChange={onUpload} data-testid="upload-input" />
          </label>
        ) : null}
      </section>

      {/* Links */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-gray-600">Links</h2>
        <ul className="space-y-1 text-sm" data-testid="links">
          {links.map((l) => (
            <li key={l.id}>
              {l.direction === 'from' ? '→' : '←'} {l.type}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <form className="mt-2 flex gap-2" onSubmit={postLink}>
            <input
              type="text"
              placeholder="ALPHA-2"
              value={linkTo}
              onChange={(e) => setLinkTo(e.target.value)}
              className="rounded border p-1 text-sm"
              data-testid="link-to"
            />
            <select
              value={linkType}
              onChange={(e) => setLinkType(e.target.value)}
              className="rounded border p-1 text-sm"
            >
              <option value="BLOCKS">BLOCKS</option>
              <option value="RELATES_TO">RELATES_TO</option>
              <option value="DUPLICATES">DUPLICATES</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              data-testid="link-submit"
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Link
            </button>
          </form>
        ) : null}
      </section>

      {/* Activity */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-gray-600">Activity</h2>
        <ul className="space-y-1 text-xs text-gray-700" data-testid="activity">
          {activity.map((a) => (
            <li key={a.id}>
              <span className="text-gray-500">{new Date(a.at).toLocaleString()}</span> ·{' '}
              <span className="font-mono">{a.field}</span>
              {a.before ? <span> ({a.before} → </span> : <span> (</span>}
              {a.after ?? '∅'})
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
