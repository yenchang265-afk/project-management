/* Integration tests for repo/workflows (G-13) against a REAL MariaDB.
   Uses cadence_test; self-skips without DATABASE_ADMIN_URL — same pattern as
   registries.integration.test.ts. Proves: schemes validate before storage,
   project resolution falls back to the engine default, and deleting a scheme
   reverts its projects (FK ON DELETE SET NULL). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import mysql, { type Connection } from "mysql2/promise";
import "../../scripts/load-env";
import { TRANSITIONS, type TransitionDef } from "@/lib/engine";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const testUrl = adminUrl?.replace(/\/[^/?]+(\?|$)/, "/cadence_test$1");

if (testUrl) {
  process.env.DATABASE_URL = testUrl;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "integration_test_secret_0123456789abcdef";
}

describe.skipIf(!adminUrl)("repo/workflows against MariaDB (cadence_test)", () => {
  let admin: Connection;
  let repo: typeof import("./repo/workflows");
  let prj: string;

  beforeAll(async () => {
    admin = await mysql.createConnection({ uri: testUrl!, multipleStatements: true });
    await admin.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of ["workflow_schemes", "dashboard_prefs", "automation_runs", "automation_rules", "forms", "item_goals", "goals", "webhooks", "api_tokens", "versions", "attachments", "field_defs", "labels", "components", "filters", "events", "sessions", "sprints",
                     "notifications", "team_members", "project_teams", "teams", "organizations",
                     "announcements", "projects", "users", "items", "schema_migrations"])
      await admin.query(`DROP TABLE IF EXISTS ${t}`);
    await admin.query("SET FOREIGN_KEY_CHECKS=1");
    const dir = join(process.cwd(), "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort())
      await admin.query(readFileSync(join(dir, f), "utf8"));

    repo = await import("./repo/workflows");
    const seedDb = await import("./seed-db");
    await seedDb.seedUsers(admin);
    await seedDb.seedStructure(admin);
    const s = await import("./repo/structure");
    prj = (await s.getStructure()).projects[0].id;
  });

  afterAll(async () => {
    await admin?.end();
    const { pool } = await import("./db");
    await pool().end();
  });

  it("rejects a malformed scheme, stores a valid one", async () => {
    const broken: TransitionDef[] = [{ from: "backlog", to: "in_discovery", roles: [], kind: "forward", label: "x" }];
    expect((await repo.createScheme("broken", broken)).ok).toBe(false);

    const good = await repo.createScheme("Kanban", TRANSITIONS);
    expect(good).toEqual({ ok: true, id: "wfs-kanban" });
    expect((await repo.createScheme("Kanban", TRANSITIONS)).ok).toBe(false); // dup name
    expect((await repo.listSchemes()).map((s) => s.name)).toEqual(["Kanban"]);
  });

  it("resolves project transitions: default until assigned, scheme after, reverts on delete", async () => {
    // no scheme → undefined (engine falls back to built-in TRANSITIONS)
    expect(await repo.getProjectTransitions(prj)).toBeUndefined();
    expect(await repo.getProjectTransitions(null)).toBeUndefined();

    const custom: TransitionDef[] = [
      ...TRANSITIONS,
      { from: "backlog", to: "in_qa", roles: ["PM"], kind: "forward", label: "Fast-track" },
    ];
    const made = await repo.createScheme("Fast track", custom);
    expect(made.ok).toBe(true);
    if (!made.ok) return;

    expect((await repo.assignScheme(prj, made.id)).ok).toBe(true);
    const resolved = await repo.getProjectTransitions(prj);
    expect(resolved?.some((t) => t.from === "backlog" && t.to === "in_qa")).toBe(true);

    // bad assignment targets rejected
    expect((await repo.assignScheme(prj, "wfs-nope")).ok).toBe(false);
    expect((await repo.assignScheme("prj-nope", made.id)).ok).toBe(false);

    // delete the scheme → project reverts to engine default (FK SET NULL)
    expect((await repo.deleteScheme(made.id)).ok).toBe(true);
    expect(await repo.getProjectTransitions(prj)).toBeUndefined();
  });

  it("updateScheme replaces the table and re-validates", async () => {
    const made = await repo.createScheme("Editable", TRANSITIONS);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    // invalid update rejected, scheme unchanged
    expect((await repo.updateScheme(made.id, "Editable", [])).ok).toBe(false);
    const trimmed = TRANSITIONS.filter((t) => t.label !== "Defer");
    expect((await repo.updateScheme(made.id, "Editable v2", trimmed)).ok).toBe(true);
    const reread = await repo.getScheme(made.id);
    expect(reread?.name).toBe("Editable v2");
    expect(reread?.transitions.length).toBe(trimmed.length);
  });
});
