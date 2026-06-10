/* Repository: items + append-only events. SQL lives here and nowhere else.
   All statements are parameterized (zero string-built SQL). */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { Item, PdlcEvent, Role } from "@/lib/engine";
import { fromJson, pool, withTransaction } from "../db";
import { eventToRow } from "../seed-db";
import { runCommand, type Command, type CommandResult } from "../commands";

interface ItemRow extends RowDataPacket {
  id: string; title: string; area: string; priority: Item["priority"];
  parent: string | null; type: Item["type"];
  stakeholders: unknown; work_items: unknown; plan: unknown;
}
interface EventRow extends RowDataPacket {
  id: string; item_id: string; type: PdlcEvent["type"]; actor: string;
  role: Role; ts: number; payload: unknown;
}

function rowToEvent(r: EventRow): PdlcEvent {
  return {
    id: r.id, item: r.item_id, type: r.type, actor: r.actor, role: r.role, ts: Number(r.ts),
    ...fromJson<Record<string, unknown>>(r.payload),
  } as PdlcEvent;
}

function rowToItem(r: ItemRow, events: PdlcEvent[]): Item {
  return {
    id: r.id, title: r.title, area: r.area, priority: r.priority, parent: r.parent, type: r.type,
    stakeholders: fromJson(r.stakeholders),
    workItems: fromJson(r.work_items),
    ...(r.plan != null ? { plan: fromJson<Item["plan"]>(r.plan) } : {}),
    events,
  };
}

export interface ItemWithVersion { item: Item; version: number; }

export async function getAllItems(): Promise<ItemWithVersion[]> {
  const [itemRows] = await pool().query<ItemRow[]>("SELECT * FROM items");
  const [eventRows] = await pool().query<EventRow[]>("SELECT * FROM events ORDER BY ts, seq");
  const byItem = new Map<string, PdlcEvent[]>();
  for (const r of eventRows) {
    if (!byItem.has(r.item_id)) byItem.set(r.item_id, []);
    byItem.get(r.item_id)!.push(rowToEvent(r));
  }
  return itemRows.map((r) => {
    const events = byItem.get(r.id) || [];
    return { item: rowToItem(r, events), version: events.length };
  });
}

export async function getItem(id: string, conn?: PoolConnection): Promise<ItemWithVersion | null> {
  const q = conn ?? pool();
  const [itemRows] = await q.query<ItemRow[]>("SELECT * FROM items WHERE id = ?", [id]);
  if (!itemRows[0]) return null;
  const [eventRows] = await q.query<EventRow[]>(
    "SELECT * FROM events WHERE item_id = ? ORDER BY ts, seq", [id]);
  const events = eventRows.map(rowToEvent);
  return { item: rowToItem(itemRows[0], events), version: events.length };
}

export type AppendOutcome =
  | { status: "ok"; event: PdlcEvent; version: number }
  | { status: "stale"; item: Item; version: number }
  | { status: "rejected"; result: Extract<CommandResult, { ok: false }> }
  | { status: "not_found" };

/** The write path: lock item row → check version → run engine → append event. */
export async function applyCommand(
  itemId: string, expectedVersion: number, cmd: Command, actor: string, role: Role
): Promise<AppendOutcome> {
  return withTransaction(async (conn) => {
    const [lock] = await conn.query<ItemRow[]>("SELECT id FROM items WHERE id = ? FOR UPDATE", [itemId]);
    if (!lock[0]) return { status: "not_found" as const };

    const loaded = await getItem(itemId, conn);
    if (!loaded) return { status: "not_found" as const };
    if (loaded.version !== expectedVersion)
      return { status: "stale" as const, item: loaded.item, version: loaded.version };

    const result = runCommand(loaded.item, cmd, actor, role);
    if (!result.ok) return { status: "rejected" as const, result };

    const r = eventToRow(result.event);
    await conn.query(
      "INSERT INTO events (id, item_id, type, actor, role, ts, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [r.id, r.item_id, r.type, r.actor, r.role, r.ts, r.payload]);
    return { status: "ok" as const, event: result.event, version: loaded.version + 1 };
  });
}

export type SpawnOutcome =
  | { status: "ok"; child: Item; parentEvent: PdlcEvent; parentVersion: number }
  | { status: "stale"; item: Item; version: number }
  | { status: "not_found" }
  | { status: "error"; message: string };

/** Spawn an iteration child: new item row + CREATE event + SPAWN_CHILD on the parent, atomically. */
export async function spawnChild(
  parentId: string, expectedVersion: number, childId: string,
  buildChild: (parent: Item) => { child: Item; parentEvent: PdlcEvent }
): Promise<SpawnOutcome> {
  return withTransaction(async (conn) => {
    const [lock] = await conn.query<ItemRow[]>("SELECT id FROM items WHERE id = ? FOR UPDATE", [parentId]);
    if (!lock[0]) return { status: "not_found" as const };

    const loaded = await getItem(parentId, conn);
    if (!loaded) return { status: "not_found" as const };
    if (loaded.version !== expectedVersion)
      return { status: "stale" as const, item: loaded.item, version: loaded.version };

    const [dup] = await conn.query<ItemRow[]>("SELECT id FROM items WHERE id = ?", [childId]);
    if (dup[0]) return { status: "error" as const, message: `Item ${childId} already exists.` };

    const { child, parentEvent } = buildChild(loaded.item);
    await conn.query(
      `INSERT INTO items (id, title, area, priority, parent, type, stakeholders, work_items, plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [child.id, child.title, child.area, child.priority, child.parent, child.type,
       JSON.stringify(child.stakeholders), JSON.stringify(child.workItems || []),
       child.plan ? JSON.stringify(child.plan) : null]);
    for (const e of child.events) {
      const r = eventToRow(e);
      await conn.query(
        "INSERT INTO events (id, item_id, type, actor, role, ts, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [r.id, r.item_id, r.type, r.actor, r.role, r.ts, r.payload]);
    }
    const pr = eventToRow(parentEvent);
    await conn.query(
      "INSERT INTO events (id, item_id, type, actor, role, ts, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [pr.id, pr.item_id, pr.type, pr.actor, pr.role, pr.ts, pr.payload]);

    return { status: "ok" as const, child, parentEvent, parentVersion: loaded.version + 1 };
  });
}
