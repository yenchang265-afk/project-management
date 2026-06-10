/* Migration runner — applies migrations/*.sql in filename order, records each in
   schema_migrations. Runs as DATABASE_ADMIN_URL (DDL rights). Idempotent.
   Usage: npm run db:migrate */
import "./load-env";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL is not set (admin/DDL connection for migrations).");

  const conn = await mysql.createConnection({ uri: url, multipleStatements: true });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    const [rows] = await conn.query("SELECT version FROM schema_migrations");
    const applied = new Set((rows as { version: string }[]).map((r) => r.version));

    const dir = join(process.cwd(), "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    for (const f of files) {
      if (applied.has(f)) { console.log(`= ${f} (already applied)`); continue; }
      const sql = readFileSync(join(dir, f), "utf8");
      await conn.beginTransaction();
      try {
        await conn.query(sql);
        await conn.query("INSERT INTO schema_migrations (version) VALUES (?)", [f]);
        await conn.commit();
        console.log(`+ ${f}`);
      } catch (e) {
        await conn.rollback();
        throw new Error(`Migration ${f} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log("Migrations up to date.");
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
