/* Seed the database with the demo fixture + two dev logins.
   Usage: npm run db:seed  (requires DATABASE_ADMIN_URL) */
import "./load-env";
import mysql from "mysql2/promise";
import { seedItems, seedUsers } from "../src/server/seed-db";

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL is not set.");

  const conn = await mysql.createConnection({ uri: url });
  try {
    const n = await seedItems(conn);
    const users = await seedUsers(conn);
    console.log(`Seeded ${n} items.`);
    console.log("Logins (override via SEED_PM_PASSWORD / SEED_DEV_PASSWORD):");
    for (const u of users) console.log(`  ${u.email} / ${u.password}`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
