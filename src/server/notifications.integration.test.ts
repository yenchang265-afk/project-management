/* Integration tests for the notifications repo against a REAL MariaDB.
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

describe.skipIf(!adminUrl)("repo/notifications against MariaDB (cadence_test)", () => {
  let admin: Connection;
  let repo: typeof import("./repo/notifications");
  let maya: string; // user ids resolved from the seed
  let sam: string;

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

    repo = await import("./repo/notifications");
    const seedDb = await import("./seed-db");
    await seedDb.seedUsers(admin);
    const s = await import("./repo/structure");
    const users = await s.getUsers();
    maya = users.find((u) => u.name === "Maya Chen")!.id;
    sam = users.find((u) => u.name === "Sam Okafor")!.id;
  });

  afterAll(async () => {
    await admin?.end();
    const { pool } = await import("./db");
    await pool().end();
  });

  it("createNotifications batch-inserts; listNotifications returns OWN rows, newest first", async () => {
    await repo.createNotifications([
      { userId: maya, itemId: "PAY-412", kind: "transition", message: "first" },
      { userId: maya, itemId: "PAY-412", kind: "comment", message: "second" },
      { userId: sam, itemId: "NOTIF-88", kind: "mention", message: "for sam" },
    ]);
    const mine = await repo.listNotifications(maya);
    expect(mine).toHaveLength(2);
    expect(mine.every((n) => n.readAt === null)).toBe(true);
    expect(mine.map((n) => n.message)).not.toContain("for sam"); // own rows only
    const theirs = await repo.listNotifications(sam);
    expect(theirs.map((n) => n.message)).toEqual(["for sam"]);
    expect(theirs[0].itemId).toBe("NOTIF-88");
    expect(theirs[0].kind).toBe("mention");
  });

  it("createNotifications with an empty batch is a no-op", async () => {
    await expect(repo.createNotifications([])).resolves.not.toThrow();
  });

  it("markRead with explicit ids marks ONLY own unread rows", async () => {
    const mine = await repo.listNotifications(maya);
    const target = mine[0].id;
    const foreign = (await repo.listNotifications(sam))[0].id;
    await repo.markRead(maya, [target, foreign]); // foreign id must be ignored
    const after = await repo.listNotifications(maya);
    expect(after.find((n) => n.id === target)!.readAt).not.toBeNull();
    expect((await repo.listNotifications(sam))[0].readAt).toBeNull(); // untouched
  });

  it("unreadOnly filters out read rows", async () => {
    const unread = await repo.listNotifications(maya, { unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread.every((n) => n.readAt === null)).toBe(true);
  });

  it("markRead 'all' clears every unread row for the user", async () => {
    await repo.markRead(maya, "all");
    expect(await repo.listNotifications(maya, { unreadOnly: true })).toEqual([]);
    expect((await repo.listNotifications(sam))[0].readAt).toBeNull(); // other users untouched
  });

  it("deleting a user cascades their notifications (FK ON DELETE CASCADE)", async () => {
    const [rows] = await admin.query(
      "INSERT INTO users (id, email, name, role, password_hash) VALUES ('u-tmp', 'tmp@x.io', 'Tmp User', 'Dev', 'x')");
    void rows;
    await repo.createNotifications([{ userId: "u-tmp", itemId: null, kind: "comment", message: "doomed" }]);
    expect(await repo.listNotifications("u-tmp")).toHaveLength(1);
    await admin.query("DELETE FROM users WHERE id = 'u-tmp'");
    expect(await repo.listNotifications("u-tmp")).toEqual([]);
  });
});
