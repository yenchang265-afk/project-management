/* Integration tests for the sprints repo against a REAL MariaDB.
   Uses the cadence_test database (never the dev one). Self-skips when no
   DATABASE_ADMIN_URL is available — same pattern as items.integration.test.ts. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import mysql, { type Connection } from "mysql2/promise";
import "../../scripts/load-env";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const testUrl = adminUrl?.replace(/\/[^/?]+(\?|$)/, "/cadence_test$1");

// Point the app pool at the TEST database before any repo import touches env().
if (testUrl) {
  process.env.DATABASE_URL = testUrl;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "integration_test_secret_0123456789abcdef";
}

describe.skipIf(!adminUrl)("repo/sprints against MariaDB (cadence_test)", () => {
  let admin: Connection;
  let repo: typeof import("./repo/sprints");
  let seedDb: typeof import("./seed-db");

  beforeAll(async () => {
    admin = await mysql.createConnection({ uri: testUrl!, multipleStatements: true });
    // fresh schema: drop in FK order, re-apply every migration in filename order
    await admin.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of ["events", "sessions", "sprints", "team_members", "project_teams", "teams",
                     "organizations", "announcements", "projects", "users", "items", "schema_migrations"])
      await admin.query(`DROP TABLE IF EXISTS ${t}`);
    await admin.query("SET FOREIGN_KEY_CHECKS=1");
    const dir = join(process.cwd(), "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort())
      await admin.query(readFileSync(join(dir, f), "utf8"));

    repo = await import("./repo/sprints");
    seedDb = await import("./seed-db");
    await seedDb.seedUsers(admin);      // team_members FK
    await seedDb.seedStructure(admin);  // teams before sprints (sprints.team_id FK)
  });

  afterAll(async () => {
    await admin?.end();
    const { pool } = await import("./db");
    await pool().end();
  });

  it("seedStructure registers the demo team's sprints (idempotently)", async () => {
    const sprints = await repo.listSprints("team-checkout");
    expect(sprints.map((s) => s.name)).toEqual(["Sprint 24", "Sprint 25"]);
    expect(sprints[0].state).toBe("active");
    expect(sprints[1].state).toBe("future");
    await seedDb.seedStructure(admin); // re-seed must not duplicate or fail
    expect((await repo.listSprints("team-checkout")).length).toBe(2);
  });

  it("createSprint mints a team-suffixed id and lists dated sprints in order", async () => {
    const r = await repo.createSprint("team-growth", "Sprint 30", "2026-06-15", "2026-06-28");
    expect(r).toEqual({ ok: true, id: "spr-sprint-30-growth" });
    const r2 = await repo.createSprint("team-growth", "Undated", null, null);
    expect(r2.ok).toBe(true);
    const sprints = await repo.listSprints("team-growth");
    expect(sprints.map((s) => s.name)).toEqual(["Sprint 30", "Undated"]); // dated first, undated last
    const s30 = sprints[0];
    expect(s30.teamId).toBe("team-growth");
    expect(s30.start).toBe("2026-06-15"); // DATE round-trips as YYYY-MM-DD
    expect(s30.end).toBe("2026-06-28");
    expect(s30.state).toBe("future");     // default
  });

  it("duplicate name on the same team → ok:false; same name on another team → ok", async () => {
    const dup = await repo.createSprint("team-growth", "Sprint 30", null, null);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain("already exists");
    const other = await repo.createSprint("team-identity", "Sprint 30", null, null);
    expect(other).toEqual({ ok: true, id: "spr-sprint-30-identity" }); // no cross-team collision
  });

  it("createSprint on an unknown team → ok:false (no orphan row)", async () => {
    const r = await repo.createSprint("team-nope", "Sprint 1", null, null);
    expect(r).toEqual({ ok: false, error: "Team not found." });
  });

  it("updateSprint patches fields, clears dates with null, and flips state", async () => {
    const id = "spr-sprint-30-growth";
    expect((await repo.updateSprint(id, { state: "active", name: "Sprint 30b" })).ok).toBe(true);
    expect((await repo.updateSprint(id, { start: null })).ok).toBe(true);
    const s = (await repo.listSprints("team-growth")).find((x) => x.id === id)!;
    expect(s.name).toBe("Sprint 30b");
    expect(s.state).toBe("active");
    expect(s.start).toBeNull();
    expect(s.end).toBe("2026-06-28");
  });

  it("updateSprint rejects unknown ids, empty patches, and renames onto an existing name", async () => {
    expect((await repo.updateSprint("spr-nope", { state: "closed" })).ok).toBe(false);
    expect((await repo.updateSprint("spr-sprint-30-growth", {})).ok).toBe(false);
    const r = await repo.updateSprint("spr-undated-growth", { name: "Sprint 30b" });
    expect(r.ok).toBe(false); // UNIQUE(team_id, name)
  });

  it("deleting a team cascades its sprints", async () => {
    const s = await import("./repo/structure");
    const tm = await s.createTeam("Sprint Cascade Crew");
    expect(tm.ok).toBe(true);
    if (!tm.ok) return;
    expect((await repo.createSprint(tm.id, "Doomed Sprint", null, null)).ok).toBe(true);
    await admin.query("DELETE FROM teams WHERE id = ?", [tm.id]);
    expect(await repo.listSprints(tm.id)).toEqual([]);
  });

  it("isTeamMember reflects team_members for the read guard", async () => {
    const s = await import("./repo/structure");
    const users = await s.getUsers();
    const maya = users.find((u) => u.name === "Maya Chen")!;
    const priya = users.find((u) => u.name === "Priya Patel")!;
    expect(await repo.isTeamMember("team-checkout", maya.id)).toBe(true);   // seeded member
    expect(await repo.isTeamMember("team-checkout", priya.id)).toBe(false); // not on this team
  });

  it("resetStructure restores the seed registry (runtime sprints wiped with their teams)", async () => {
    // simulate the e2e reset: items/events are wiped first (items.project_id FK)
    await admin.query("DELETE FROM events");
    await admin.query("DELETE FROM items WHERE parent IS NOT NULL");
    await admin.query("DELETE FROM items");
    await seedDb.resetStructure(admin);
    expect((await repo.listSprints("team-checkout")).map((x) => x.name)).toEqual(["Sprint 24", "Sprint 25"]);
    expect(await repo.listSprints("team-growth")).toEqual([]); // runtime-created sprints gone
  });
});
