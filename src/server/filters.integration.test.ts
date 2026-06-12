/* Integration tests for the saved-filters repo against a REAL MariaDB.
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

describe.skipIf(!adminUrl)("repo/filters against MariaDB (cadence_test)", () => {
  let admin: Connection;
  let repo: typeof import("./repo/filters");
  let maya: string;
  let priya: string;

  beforeAll(async () => {
    admin = await mysql.createConnection({ uri: testUrl!, multipleStatements: true });
    // fresh schema: drop in FK order, re-apply every migration in filename order
    await admin.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of ["filters", "events", "sessions", "sprints", "notifications", "team_members",
                     "project_teams", "teams", "organizations", "announcements", "projects",
                     "users", "items", "schema_migrations"])
      await admin.query(`DROP TABLE IF EXISTS ${t}`);
    await admin.query("SET FOREIGN_KEY_CHECKS=1");
    const dir = join(process.cwd(), "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort())
      await admin.query(readFileSync(join(dir, f), "utf8"));

    repo = await import("./repo/filters");
    const seedDb = await import("./seed-db");
    await seedDb.seedUsers(admin);
    const s = await import("./repo/structure");
    const users = await s.getUsers();
    maya = users.find((u) => u.name === "Maya Chen")!.id;
    priya = users.find((u) => u.name === "Priya Patel")!.id;
  });

  afterAll(async () => {
    await admin?.end();
    const { pool } = await import("./db");
    await pool().end();
  });

  it("createFilter mints an owner-suffixed id; duplicate name per owner → ok:false", async () => {
    const r = await repo.createFilter(maya, "My todos", "state = todo", false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBe(`flt-my-todos-${maya.slice(0, 8)}`);
    const dup = await repo.createFilter(maya, "My todos", "state = done", false);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain("already have");
    // same name for ANOTHER owner is fine (unique per owner, id disambiguated)
    expect((await repo.createFilter(priya, "My todos", "state = todo", false)).ok).toBe(true);
  });

  it("listFilters returns own + shared, not others' private filters", async () => {
    expect((await repo.createFilter(priya, "Team board", "sprint = S1", true)).ok).toBe(true);
    const mine = await repo.listFilters(maya);
    const names = mine.map((f) => `${f.name}:${f.shared ? 1 : 0}`);
    expect(names).toContain("My todos:0");     // own private
    expect(names).toContain("Team board:1");   // someone else's shared
    expect(mine.some((f) => f.ownerId === priya && !f.shared)).toBe(false); // priya's private hidden
  });

  it("deleteFilter is owner-only; a foreign id reads as missing", async () => {
    const mayasOwn = (await repo.listFilters(maya)).find((f) => f.ownerId === maya)!;
    const foreign = await repo.deleteFilter(mayasOwn.id, priya);
    expect(foreign).toEqual({ ok: false, error: "Filter not found." });
    expect((await repo.deleteFilter(mayasOwn.id, maya)).ok).toBe(true);
    expect((await repo.listFilters(maya)).some((f) => f.id === mayasOwn.id)).toBe(false);
  });

  it("deleting a user cascades their filters", async () => {
    await admin.query(
      "INSERT INTO users (id, email, name, role, password_hash) VALUES ('u-doomed', 'doom@x.test', 'Doomed', 'Dev', 'x')");
    expect((await repo.createFilter("u-doomed", "Mine", "state = todo", true)).ok).toBe(true);
    await admin.query("DELETE FROM users WHERE id = 'u-doomed'");
    expect((await repo.listFilters(maya)).some((f) => f.ownerId === "u-doomed")).toBe(false);
  });
});
