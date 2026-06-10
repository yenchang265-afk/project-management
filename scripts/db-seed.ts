/* Seed the database with the demo fixture + two dev logins.
   Usage: npm run db:seed  (requires DATABASE_ADMIN_URL) */
import "./load-env";
import mysql from "mysql2/promise";
import { SEED_PROJECTS, SEED_TEAMS, seedItems, seedStructure, seedUsers } from "../src/server/seed-db";

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL is not set.");

  const conn = await mysql.createConnection({ uri: url });
  try {
    const users = await seedUsers(conn);       // users first (team_members FK)
    await seedStructure(conn);                 // projects/teams + join tables
    const n = await seedItems(conn);           // items reference projects
    console.log(`Seeded ${n} items, ${SEED_PROJECTS.length} projects, ${SEED_TEAMS.length} teams.`);
    console.log("Logins (override via SEED_*_PASSWORD):");
    for (const u of users) console.log(`  ${u.email} / ${u.password}`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
