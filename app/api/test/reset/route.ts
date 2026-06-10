import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { seedItems } from "@/server/seed-db";

/* E2E-ONLY: re-seed items/events so every test starts from the known fixture.
   Hard-disabled unless E2E_TEST=1 (never set in production). Uses the admin
   connection because the runtime app user deliberately can't DELETE events. */
export async function POST(): Promise<NextResponse> {
  if (process.env.E2E_TEST !== "1")
    return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url)
    return NextResponse.json({ success: false, error: "DATABASE_ADMIN_URL not set." }, { status: 500 });

  const conn = await mysql.createConnection({ uri: url });
  try {
    const n = await seedItems(conn);
    return NextResponse.json({ success: true, data: { items: n } });
  } finally {
    await conn.end();
  }
}
