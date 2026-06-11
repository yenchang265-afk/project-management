/* Integration tests for the bulk command path (the body of POST /api/items/bulk)
   against a REAL MariaDB. Ops run sequentially; each is scope-checked then
   version-checked exactly like the single-command route, and partial success
   is expected. Same self-skip pattern as items.integration.test.ts. */
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

describe.skipIf(!adminUrl)("bulk commands against MariaDB (cadence_test)", () => {
  let admin: Connection;
  let repo: typeof import("./repo/items");
  let bulk: typeof import("./bulk");
  let pm: import("./auth").AuthedUser;
  let sam: import("./auth").AuthedUser; // Dev — sees commerce+identity, NOT discovery

  beforeAll(async () => {
    admin = await mysql.createConnection({ uri: testUrl!, multipleStatements: true });
    // fresh schema: drop in FK order, re-apply every migration in filename order
    await admin.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of ["notifications", "events", "sessions", "sprints", "team_members", "project_teams",
                     "teams", "organizations", "announcements", "projects", "users", "items", "schema_migrations"])
      await admin.query(`DROP TABLE IF EXISTS ${t}`);
    await admin.query("SET FOREIGN_KEY_CHECKS=1");
    const dir = join(process.cwd(), "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort())
      await admin.query(readFileSync(join(dir, f), "utf8"));

    repo = await import("./repo/items");
    bulk = await import("./bulk");
    const seedDb = await import("./seed-db");
    await seedDb.seedUsers(admin);      // team_members FK
    await seedDb.seedStructure(admin);  // projects/teams before items (items.project_id FK)
    await seedDb.seedItems(admin);

    const users = await (await import("./repo/structure")).getUsers();
    const u = (name: string) => users.find((x) => x.name === name)!;
    pm = { id: u("Maya Chen").id, email: "maya@cadence.dev", name: "Maya Chen", role: "PM" };
    sam = { id: u("Sam Okafor").id, email: "sam@cadence.dev", name: "Sam Okafor", role: "Dev" };
  });

  afterAll(async () => {
    await admin?.end();
    const { pool } = await import("./db");
    await pool().end();
  });

  it("happy path: sequential ops across items all apply, one event each", async () => {
    const v412 = (await repo.getItem("PAY-412"))!.version;
    const v88 = (await repo.getItem("NOTIF-88"))!.version;

    const results = await bulk.runBulkOps(pm, [
      { itemId: "PAY-412", expectedVersion: v412,     command: { kind: "wiUpdate", wiId: "PAY-418", patch: { sprint: "Sprint 25" } } },
      { itemId: "PAY-412", expectedVersion: v412 + 1, command: { kind: "wiUpdate", wiId: "PAY-419", patch: { sprint: "Sprint 25" } } },
      { itemId: "NOTIF-88", expectedVersion: v88,     command: { kind: "flag", flag: "on_hold", value: true, reason: "bulk test" } },
    ]);

    expect(results.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
    expect(results.map((r) => r.itemId)).toEqual(["PAY-412", "PAY-412", "NOTIF-88"]);
    expect(results[0].version).toBe(v412 + 1);
    expect(results[1].version).toBe(v412 + 2);
    expect(results[2].version).toBe(v88 + 1);
    expect(results[2].event?.type).toBe("FLAG_SET");

    const after = (await repo.getItem("PAY-412"))!;
    expect(after.version).toBe(v412 + 2);
    const { deriveItem } = await import("../lib/engine");
    const snap = deriveItem(after.item);
    expect(snap.workItems.find((w) => w.id === "PAY-418")!.sprint).toBe("Sprint 25");
    expect(snap.workItems.find((w) => w.id === "PAY-419")!.sprint).toBe("Sprint 25");
  });

  it("partial failure: a stale op fails alone — later ops still apply", async () => {
    const v412 = (await repo.getItem("PAY-412"))!.version;
    const v88 = (await repo.getItem("NOTIF-88"))!.version;

    const results = await bulk.runBulkOps(pm, [
      { itemId: "PAY-412", expectedVersion: v412, command: { kind: "flag", flag: "on_hold", value: true, reason: "first wins" } },
      // same expectedVersion again → the first op already moved the item → stale
      { itemId: "PAY-412", expectedVersion: v412, command: { kind: "flag", flag: "on_hold", value: false, reason: null } },
      { itemId: "NOTIF-88", expectedVersion: v88, command: { kind: "flag", flag: "on_hold", value: false, reason: null } },
    ]);

    expect(results.map((r) => r.status)).toEqual(["ok", "stale", "ok"]);
    expect(results[1].version).toBe(v412 + 1); // fresh version travels back for reconcile
    expect(results[1].event).toBeUndefined();
    expect((await repo.getItem("PAY-412"))!.version).toBe(v412 + 1); // stale op wrote nothing
    expect((await repo.getItem("NOTIF-88"))!.version).toBe(v88 + 1); // later op unaffected
  });

  it("engine rejection surfaces a per-op error without an event", async () => {
    const v = (await repo.getItem("PAY-412"))!.version;
    const results = await bulk.runBulkOps(pm, [
      { itemId: "PAY-412", expectedVersion: v, command: { kind: "transition", to: "released", reason: null } },
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[0].error).toBeTruthy();
    expect(results[0].event).toBeUndefined();
    expect((await repo.getItem("PAY-412"))!.version).toBe(v); // nothing appended
  });

  it("scope: Dev writes in-scope items; out-of-scope and unknown ids → not_found", async () => {
    const v412 = (await repo.getItem("PAY-412"))!.version;
    const v88 = (await repo.getItem("NOTIF-88"))!.version;

    const results = await bulk.runBulkOps(sam, [
      { itemId: "PAY-412", expectedVersion: v412, command: { kind: "flag", flag: "blocked", value: false, reason: null } },
      { itemId: "NOTIF-88", expectedVersion: v88, command: { kind: "flag", flag: "blocked", value: true, reason: "x" } }, // prj-discovery: not Sam's
      { itemId: "NOPE-1", expectedVersion: 0, command: { kind: "flag", flag: "blocked", value: true, reason: null } },
    ]);

    expect(results.map((r) => r.status)).toEqual(["ok", "not_found", "not_found"]);
    expect((await repo.getItem("NOTIF-88"))!.version).toBe(v88); // out-of-scope op wrote nothing
  });
});
