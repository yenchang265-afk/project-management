/* Shared seed routine: wipes items/events and re-inserts the buildSeed() fixture.
   Used by scripts/db-seed.ts (CLI) and the e2e-only reset endpoint.
   Users are upserted, never wiped. */
import type { Connection } from "mysql2/promise";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
// relative imports (not @/) so tsx-run scripts resolve without tsconfig-paths support
import { buildSeed } from "../lib/seed";
import { sprintIdFor } from "../lib/sprints";
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

// Company (Cadence) → orgs → teams. Strict tree: each team belongs to one org.
export const SEED_ORGS = [
  { id: "org-platform", name: "Platform Org" },
  { id: "org-growth", name: "Growth Org" },
];

// scope_id: null = company-wide · org id · team id
export const SEED_ANNOUNCEMENTS = [
  { id: "ann-seed-1", scope_type: "company" as const, scope_id: null, author: "Maya Chen",
    title: "Q3 planning kickoff Monday", body: "All-hands at 10:00. Come with your top three priorities for the quarter." },
  { id: "ann-seed-2", scope_type: "org" as const, scope_id: "org-platform", author: "Maya Chen",
    title: "Platform infra freeze next week", body: "No production infra changes Mon–Wed while we migrate the primary cluster." },
  { id: "ann-seed-3", scope_type: "team" as const, scope_id: "team-checkout", author: "Maya Chen",
    title: "Checkout standup moved to 10:00", body: "Starting this sprint, daily standup shifts 30 minutes later." },
];

export const SEED_TEAMS = [
  // multi-team ownership: Commerce and Identity are each owned by two teams
  { id: "team-checkout", name: "Checkout Crew", org: "org-platform", projects: ["prj-commerce"], members: ["maya@cadence.dev", "sam@cadence.dev"] },
  { id: "team-identity", name: "Identity Core", org: "org-growth", projects: ["prj-identity"], members: ["lena@cadence.dev", "sam@cadence.dev"] },
  { id: "team-growth", name: "Growth Guild", org: "org-growth", projects: ["prj-discovery", "prj-onboarding"], members: ["maya@cadence.dev", "priya@cadence.dev"] },
  { id: "team-platform", name: "Platform Foundation", org: "org-platform", projects: ["prj-commerce", "prj-identity"], members: ["sam@cadence.dev", "priya@cadence.dev"] },
];

// First-class sprint registry for the demo team. "Sprint 24" matches the
// free-text sprint strings the work-item fixture uses; "Sprint 25" is upcoming.
export const SEED_SPRINTS = [
  { team: "team-checkout", name: "Sprint 24", start: "2026-06-01", end: "2026-06-14", state: "active" as const },
  { team: "team-checkout", name: "Sprint 25", start: "2026-06-15", end: "2026-06-28", state: "future" as const },
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

  await conn.query("DELETE FROM notifications"); // runtime fan-out — never part of the seed
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

/** Hard-reset hierarchy to the seed fixture: removes any extra projects/teams
 *  created at runtime (items/events must be wiped first — items.project_id FK). */
export async function resetStructure(conn: Connection): Promise<void> {
  await conn.query("DELETE FROM project_teams");
  await conn.query("DELETE FROM team_members");
  await conn.query("DELETE FROM teams");           // teams reference organizations
  await conn.query("DELETE FROM organizations");
  await conn.query("DELETE FROM projects");
  await conn.query("DELETE FROM workflow_schemes"); // runtime-created (G-13); projects already cleared
  await conn.query("DELETE FROM announcements");
  await seedStructure(conn);
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
  for (const o of SEED_ORGS) {                       // orgs before teams (teams.org_id FK)
    await conn.query(
      `INSERT INTO organizations (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [o.id, o.name]
    );
  }
  for (const t of SEED_TEAMS) {
    await conn.query(
      `INSERT INTO teams (id, name, org_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), org_id = VALUES(org_id)`,
      [t.id, t.name, t.org]
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
  for (const s of SEED_SPRINTS) {       // teams seeded above (sprints.team_id FK)
    await conn.query(
      `INSERT INTO sprints (id, team_id, name, start_date, end_date, state) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE start_date = VALUES(start_date), end_date = VALUES(end_date), state = VALUES(state)`,
      [sprintIdFor(s.team, s.name), s.team, s.name, s.start, s.end, s.state]
    );
  }
  for (const a of SEED_ANNOUNCEMENTS) {
    await conn.query(
      `INSERT INTO announcements (id, scope_type, scope_id, title, body, author) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), scope_type = VALUES(scope_type), scope_id = VALUES(scope_id)`,
      [a.id, a.scope_type, a.scope_id, a.title, a.body, a.author]
    );
  }
}
