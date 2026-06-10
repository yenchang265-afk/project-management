/* Integration tests for the repo + command write path against a REAL MariaDB.
   Uses the cadence_test database (never the dev one). Self-skips when no
   DATABASE_ADMIN_URL is available (e.g. CI without a DB service). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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

describe.skipIf(!adminUrl)("repo/items against MariaDB (cadence_test)", () => {
  let admin: Connection;
  let repo: typeof import("./repo/items");
  let seedDb: typeof import("./seed-db");

  beforeAll(async () => {
    admin = await mysql.createConnection({ uri: testUrl!, multipleStatements: true });
    // fresh schema: drop in FK order, re-apply 0001
    await admin.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of ["events", "sessions", "users", "items", "schema_migrations"])
      await admin.query(`DROP TABLE IF EXISTS ${t}`);
    await admin.query("SET FOREIGN_KEY_CHECKS=1");
    await admin.query(readFileSync(join(process.cwd(), "migrations", "0001_init.sql"), "utf8"));

    repo = await import("./repo/items");
    seedDb = await import("./seed-db");
    await seedDb.seedItems(admin);
  });

  afterAll(async () => {
    await admin?.end();
    const { pool } = await import("./db");
    await pool().end();
  });

  it("getAllItems returns the seeded fixture with versions = event counts", async () => {
    const rows = await repo.getAllItems();
    expect(rows.length).toBeGreaterThanOrEqual(7);
    const pay = rows.find((r) => r.item.id === "PAY-412")!;
    expect(pay.item.title).toContain("Apple Pay");
    expect(pay.version).toBe(pay.item.events.length);
    expect(pay.item.workItems.length).toBe(5);
  });

  it("applyCommand happy path appends exactly one event and bumps the version", async () => {
    const before = (await repo.getItem("PAY-412"))!;
    const out = await repo.applyCommand("PAY-412", before.version,
      { kind: "flag", flag: "on_hold", value: true, reason: "integration test" }, "Maya Chen", "PM");
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.version).toBe(before.version + 1);
    const after = (await repo.getItem("PAY-412"))!;
    expect(after.version).toBe(before.version + 1);
    expect(after.item.events[after.item.events.length - 1].type).toBe("FLAG_SET");
  });

  it("stale expectedVersion → status stale with the fresh item, no event written", async () => {
    const cur = (await repo.getItem("PAY-412"))!;
    const out = await repo.applyCommand("PAY-412", cur.version - 1,
      { kind: "flag", flag: "on_hold", value: false, reason: null }, "Maya Chen", "PM");
    expect(out.status).toBe("stale");
    if (out.status !== "stale") return;
    expect(out.version).toBe(cur.version);
    expect((await repo.getItem("PAY-412"))!.version).toBe(cur.version); // nothing appended
  });

  it("engine rejection → status rejected, no event written", async () => {
    const cur = (await repo.getItem("PAY-412"))!;
    const out = await repo.applyCommand("PAY-412", cur.version,
      { kind: "transition", to: "released", reason: null }, "Maya Chen", "PM");
    expect(out.status).toBe("rejected");
    expect((await repo.getItem("PAY-412"))!.version).toBe(cur.version);
  });

  it("unknown item → not_found", async () => {
    const out = await repo.applyCommand("NOPE-1", 0,
      { kind: "flag", flag: "blocked", value: true, reason: null }, "Maya Chen", "PM");
    expect(out.status).toBe("not_found");
  });

  it("spawnChild creates the child + lineage event atomically", async () => {
    const cur = (await repo.getItem("PAY-412"))!;
    const { ev } = await import("../lib/engine");
    const out = await repo.spawnChild("PAY-412", cur.version, "PAY-901", (parent) => ({
      child: {
        id: "PAY-901", title: parent.title + " (next iteration)", area: parent.area,
        priority: "Medium", parent: parent.id, type: "feature",
        stakeholders: parent.stakeholders, workItems: [],
        events: [ev("PAY-901", "CREATE", "Maya Chen", "PM", { to: "backlog" })],
      },
      parentEvent: ev(parent.id, "SPAWN_CHILD", "Maya Chen", "PM", { child: "PAY-901" }),
    }));
    expect(out.status).toBe("ok");
    const childRow = await repo.getItem("PAY-901");
    expect(childRow).not.toBeNull();
    expect(childRow!.item.parent).toBe("PAY-412");
    const parent = (await repo.getItem("PAY-412"))!;
    expect(parent.item.events[parent.item.events.length - 1].type).toBe("SPAWN_CHILD");
  });

  it("concurrent same-version commands: exactly one wins, the other goes stale", async () => {
    const cur = (await repo.getItem("SEARCH-220"))!;
    const mk = (v: boolean) => repo.applyCommand("SEARCH-220", cur.version,
      { kind: "flag", flag: "blocked", value: v, reason: "race" }, "Maya Chen", "PM");
    const [a, b] = await Promise.all([mk(true), mk(false)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["ok", "stale"]);
    expect((await repo.getItem("SEARCH-220"))!.version).toBe(cur.version + 1);
  });
});
