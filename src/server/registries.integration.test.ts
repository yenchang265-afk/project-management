/* Integration tests for the label/component registries against a REAL MariaDB.
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

describe.skipIf(!adminUrl)("repo/registries against MariaDB (cadence_test)", () => {
  let admin: Connection;
  let repo: typeof import("./repo/registries");

  beforeAll(async () => {
    admin = await mysql.createConnection({ uri: testUrl!, multipleStatements: true });
    // fresh schema: drop in FK order, re-apply every migration in filename order
    await admin.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of ["labels", "components", "filters", "events", "sessions", "sprints",
                     "notifications", "team_members", "project_teams", "teams", "organizations",
                     "announcements", "projects", "users", "items", "schema_migrations"])
      await admin.query(`DROP TABLE IF EXISTS ${t}`);
    await admin.query("SET FOREIGN_KEY_CHECKS=1");
    const dir = join(process.cwd(), "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort())
      await admin.query(readFileSync(join(dir, f), "utf8"));

    repo = await import("./repo/registries");
    const seedDb = await import("./seed-db");
    await seedDb.seedUsers(admin);
    await seedDb.seedStructure(admin); // projects for component FK
  });

  afterAll(async () => {
    await admin?.end();
    const { pool } = await import("./db");
    await pool().end();
  });

  it("labels: create, list alphabetical, duplicate rejected, delete", async () => {
    expect((await repo.createLabel("payments")).ok).toBe(true);
    expect(await repo.createLabel("api")).toEqual({ ok: true, id: "lbl-api" });
    const dup = await repo.createLabel("payments");
    expect(dup.ok).toBe(false);
    expect((await repo.listLabels()).map((l) => l.name)).toEqual(["api", "payments"]);
    expect((await repo.deleteLabel("lbl-api")).ok).toBe(true);
    expect((await repo.deleteLabel("lbl-api")).ok).toBe(false); // already gone
    expect((await repo.listLabels()).map((l) => l.name)).toEqual(["payments"]);
  });

  it("components: per-project unique, unknown project rejected, cascade on project delete", async () => {
    const s = await import("./repo/structure");
    const projects = (await s.getStructure()).projects;
    const prj = projects[0].id;
    const r = await repo.createComponent(prj, "Checkout API");
    expect(r.ok).toBe(true);
    expect((await repo.createComponent(prj, "Checkout API")).ok).toBe(false);   // dup in project
    expect((await repo.createComponent("prj-nope", "X")).ok).toBe(false);        // unknown project
    if (projects[1]) // same name in another project is fine
      expect((await repo.createComponent(projects[1].id, "Checkout API")).ok).toBe(true);
    expect((await repo.listComponents(prj)).map((c) => c.name)).toEqual(["Checkout API"]);
    await admin.query("DELETE FROM project_teams WHERE project_id = ?", [prj]);
    await admin.query("UPDATE items SET project_id = NULL WHERE project_id = ?", [prj]);
    await admin.query("DELETE FROM projects WHERE id = ?", [prj]);
    expect(await repo.listComponents(prj)).toEqual([]); // cascaded
  });
});
