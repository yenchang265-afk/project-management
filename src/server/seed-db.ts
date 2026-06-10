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
  { email: "priya@cadence.dev", name: "Priya Patel", role: "Dev" as const, envVar: "SEED_DEV2_PASSWORD", fallback: "priya-dev-password" },
  { email: "lena@cadence.dev", name: "Lena Petrova", role: "PM" as const, envVar: "SEED_PM2_PASSWORD", fallback: "lena-dev-password" },
];

/* ---------- Phase 2 hierarchy fixture (stable ids → idempotent re-seed) ---------- */
export const SEED_PROJECTS = [
  { id: "prj-commerce", key: "COM", name: "Commerce Platform", description: "Checkout, payments and billing", prefixes: ["PAY", "BILLING"] },
  { id: "prj-identity", key: "IDN", name: "Identity & Access", description: "Authentication and account security", prefixes: ["AUTH"] },
  { id: "prj-discovery", key: "DSC", name: "Discovery & Growth", description: "Search, ranking and lifecycle messaging", prefixes: ["SEARCH", "NOTIF"] },
  { id: "prj-onboarding", key: "ONB", name: "Onboarding Experience", description: "First-run and activation flows", prefixes: ["ONB"] },
];

export const SEED_TEAMS = [
  // multi-team ownership: Commerce and Identity are each owned by two teams
  { id: "team-checkout", name: "Checkout Crew", projects: ["prj-commerce"], members: ["maya@cadence.dev", "sam@cadence.dev"] },
  { id: "team-identity", name: "Identity Core", projects: ["prj-identity"], members: ["lena@cadence.dev", "sam@cadence.dev"] },
  { id: "team-growth", name: "Growth Guild", projects: ["prj-discovery", "prj-onboarding"], members: ["maya@cadence.dev", "priya@cadence.dev"] },
  { id: "team-platform", name: "Platform Foundation", projects: ["prj-commerce", "prj-identity"], members: ["sam@cadence.dev", "priya@cadence.dev"] },
];

export function projectForItem(itemId: string): string | null {
  const prefix = itemId.split("-")[0];
  return SEED_PROJECTS.find((p) => p.prefixes.includes(prefix))?.id ?? null;
}

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
      `INSERT INTO items (id, title, area, priority, parent, type, project_id, stakeholders, work_items, plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [it.id, it.title, it.area, it.priority, it.parent, it.type, projectForItem(it.id),
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

/** Upsert projects, teams and both M:N join tables. Users must be seeded first. */
export async function seedStructure(conn: Connection): Promise<void> {
  for (const p of SEED_PROJECTS) {
    await conn.query(
      `INSERT INTO projects (id, \`key\`, name, description) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE \`key\` = VALUES(\`key\`), name = VALUES(name), description = VALUES(description)`,
      [p.id, p.key, p.name, p.description]
    );
  }
  for (const t of SEED_TEAMS) {
    await conn.query(
      `INSERT INTO teams (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [t.id, t.name]
    );
  }
  await conn.query("DELETE FROM project_teams");
  await conn.query("DELETE FROM team_members");
  for (const t of SEED_TEAMS) {
    for (const pid of t.projects)
      await conn.query("INSERT INTO project_teams (project_id, team_id) VALUES (?, ?)", [pid, t.id]);
    for (const email of t.members)
      await conn.query(
        "INSERT INTO team_members (team_id, user_id) SELECT ?, id FROM users WHERE email = ?",
        [t.id, email]
      );
  }
}
