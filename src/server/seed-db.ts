/* Shared seed routine: wipes items/events and re-inserts the buildSeed() fixture.
   Used by scripts/db-seed.ts (CLI) and the e2e-only reset endpoint.
   Users are upserted, never wiped. */
import type { Connection } from "mysql2/promise";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
// relative imports (not @/) so tsx-run scripts resolve without tsconfig-paths support
import { buildSeed } from "../lib/seed";
import type { Item, PdlcEvent } from "../lib/engine";

export const SEED_USERS = [
  { email: "maya@cadence.dev", name: "Maya Chen", role: "PM" as const, envVar: "SEED_PM_PASSWORD", fallback: "maya-dev-password" },
  { email: "sam@cadence.dev", name: "Sam Okafor", role: "Dev" as const, envVar: "SEED_DEV_PASSWORD", fallback: "sam-dev-password" },
];

/** Split an engine event into DB columns + JSON payload (everything else). */
export function eventToRow(e: PdlcEvent) {
  const { id, item, type, actor, role, ts, ...payload } = e;
  return { id, item_id: item, type, actor, role, ts, payload: JSON.stringify(payload) };
}

export async function seedItems(conn: Connection): Promise<number> {
  const { ITEMS } = buildSeed(Date.now());

  await conn.query("DELETE FROM events");
  await conn.query("DELETE FROM items WHERE parent IS NOT NULL");
  await conn.query("DELETE FROM items");

  for (const it of ITEMS as Item[]) {
    await conn.query(
      `INSERT INTO items (id, title, area, priority, parent, type, stakeholders, work_items, plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [it.id, it.title, it.area, it.priority, it.parent, it.type,
       JSON.stringify(it.stakeholders), JSON.stringify(it.workItems || []),
       it.plan ? JSON.stringify(it.plan) : null]
    );
    for (const e of it.events) {
      const r = eventToRow(e);
      await conn.query(
        `INSERT INTO events (id, item_id, type, actor, role, ts, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.item_id, r.type, r.actor, r.role, r.ts, r.payload]
      );
    }
  }
  return ITEMS.length;
}

export async function seedUsers(conn: Connection): Promise<{ email: string; password: string }[]> {
  const out: { email: string; password: string }[] = [];
  for (const u of SEED_USERS) {
    const password = process.env[u.envVar] || u.fallback;
    const hash = await bcrypt.hash(password, 12);
    await conn.query(
      `INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), password_hash = VALUES(password_hash)`,
      [randomUUID(), u.email, u.name, u.role, hash]
    );
    out.push({ email: u.email, password });
  }
  return out;
}
