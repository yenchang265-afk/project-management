// /projects/[key]/board — kanban board. Server component fetches the board
// state; the client island handles drag-and-drop and POSTs /board/move.

import { notFound, redirect } from 'next/navigation';

import { AuthError } from '@/lib/errors';
import { requireProjectAccess } from '@/server/auth/projectAccess';
import { prisma } from '@/server/db';
import { createBoardsService } from '@/server/services/boards';

import { BoardClient } from './board-client';

export const dynamic = 'force-dynamic';

export default async function BoardPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  let access;
  try {
    access = await requireProjectAccess(key, 'VIEWER');
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'unauthenticated') redirect('/login');
      if (err.code === 'not_found') notFound();
      if (err.code === 'forbidden') redirect('/projects');
    }
    throw err;
  }

  const svc = createBoardsService({ prisma });
  const board = await svc.getBoard(key, { id: access.user.id, role: access.user.role });

  return (
    <main className="mx-auto mt-8 max-w-7xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          <span className="font-mono text-base text-gray-500">{board.project.key}</span> Board
        </h1>
      </header>
      <BoardClient projectKey={key} initialBoard={serializeBoard(board)} />
    </main>
  );
}

// Strip Date objects to JSON-safe payloads for the client island.
function serializeBoard(
  board: Awaited<ReturnType<ReturnType<typeof createBoardsService>['getBoard']>>,
) {
  return {
    project: { id: board.project.id, key: board.project.key, name: board.project.name },
    columns: board.columns.map((c) => ({
      status: c.status,
      issues: c.issues.map((i) => ({
        id: i.id,
        key: i.key,
        title: i.title,
        status: i.status,
        priority: i.priority,
        type: i.type,
        assigneeId: i.assigneeId,
      })),
    })),
  };
}
