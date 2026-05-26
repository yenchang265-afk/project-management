'use client';

// Client island for the kanban board. Uses @dnd-kit/core for drag-and-drop.
// Each card is a draggable; each column is a droppable. On drop we optimistically
// move the card and POST /board/move. If the server rejects (e.g. illegal
// transition) we revert and surface the error.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';

import { SavedFiltersDropdown } from '../saved-filters-dropdown';

export type ClientIssue = {
  id: string;
  key: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
  priority: string;
  type: string;
  assigneeId: string | null;
};

export type ClientBoard = {
  project: { id: string; key: string; name: string };
  columns: Array<{ status: ClientIssue['status']; issues: ClientIssue[] }>;
};

export function BoardClient({
  projectKey,
  initialBoard,
}: {
  projectKey: string;
  initialBoard: ClientBoard;
}) {
  const router = useRouter();
  const [board, setBoard] = useState<ClientBoard>(initialBoard);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function move(issueKey: string, toStatus: ClientIssue['status']) {
    setError(null);
    const prev = board;
    // Optimistic update.
    setBoard((b) => {
      const next: ClientBoard = {
        project: b.project,
        columns: b.columns.map((c) => ({ ...c, issues: [...c.issues] })),
      };
      let card: ClientIssue | null = null;
      for (const c of next.columns) {
        const idx = c.issues.findIndex((i) => i.key === issueKey);
        if (idx >= 0) {
          card = c.issues.splice(idx, 1)[0]!;
          break;
        }
      }
      if (!card) return b;
      card.status = toStatus;
      const target = next.columns.find((c) => c.status === toStatus);
      if (target) target.issues.unshift(card);
      return next;
    });

    const res = await fetch(`/api/projects/${projectKey}/board/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ issueKey, toStatus }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(body.error?.message ?? 'Move failed');
      setBoard(prev);
      return;
    }
    router.refresh();
  }

  function onDragEnd(e: DragEndEvent) {
    const issueKey = String(e.active.id);
    const toStatus = e.over?.id ? (String(e.over.id) as ClientIssue['status']) : null;
    if (!toStatus) return;
    // Find current status; skip no-ops.
    const current = board.columns.find((c) => c.issues.some((i) => i.key === issueKey))?.status;
    if (!current || current === toStatus) return;
    void move(issueKey, toStatus);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SavedFiltersDropdown projectId={board.project.id} />
        {error ? (
          <p className="text-sm text-red-600" data-testid="board-error">
            {error}
          </p>
        ) : null}
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
          data-testid="board-columns"
        >
          {board.columns.map((col) => (
            <Column key={col.status} status={col.status} issues={col.issues} onMove={move} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function Column({
  status,
  issues,
  onMove,
}: {
  status: ClientIssue['status'];
  issues: ClientIssue[];
  onMove: (key: string, to: ClientIssue['status']) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`rounded border bg-gray-50 p-3 ${isOver ? 'ring-2 ring-blue-400' : ''}`}
      data-testid={`board-column-${status}`}
      data-status={status}
    >
      <h2 className="mb-2 text-sm font-semibold uppercase text-gray-700">{status}</h2>
      <ul className="flex flex-col gap-2">
        {issues.map((i) => (
          <Card key={i.id} issue={i} onMove={onMove} />
        ))}
      </ul>
    </div>
  );
}

function Card({
  issue,
  onMove,
}: {
  issue: ClientIssue;
  onMove: (key: string, to: ClientIssue['status']) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.key,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`cursor-grab rounded border bg-white p-2 text-sm shadow-sm ${
        isDragging ? 'opacity-50' : ''
      }`}
      data-testid={`board-card-${issue.key}`}
      {...listeners}
      {...attributes}
    >
      <div className="font-mono text-xs text-gray-500">{issue.key}</div>
      <div>{issue.title}</div>
      {/* Click-move fallback menu for accessibility / e2e environments where
          drag is finicky. */}
      <div className="mt-1 flex gap-1 text-xs">
        {(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const)
          .filter((s) => s !== issue.status)
          .map((s) => (
            <button
              key={s}
              type="button"
              className="rounded border px-1 py-0.5 hover:bg-gray-100"
              data-testid={`move-${issue.key}-${s}`}
              onClick={(e) => {
                e.stopPropagation();
                onMove(issue.key, s);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              →{s.slice(0, 3)}
            </button>
          ))}
      </div>
    </li>
  );
}
