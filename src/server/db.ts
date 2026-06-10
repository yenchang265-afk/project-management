import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import { env } from "./env";

/* One pool per process. In Next dev the module registry survives HMR via globalThis. */
const g = globalThis as unknown as { __cadencePool?: Pool };

export function pool(): Pool {
  if (!g.__cadencePool) {
    g.__cadencePool = mysql.createPool({
      uri: env().DATABASE_URL,
      connectionLimit: 10,
      // JSON columns come back as strings on some paths; we parse explicitly in repos.
      namedPlaceholders: false,
    });
  }
  return g.__cadencePool;
}

/** Run `fn` inside a transaction; rolls back on any throw. */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try { await conn.rollback(); } catch { /* connection already broken — nothing to roll back */ }
    throw e;
  } finally {
    conn.release();
  }
}

/** JSON cell → value. mysql2 usually parses JSON columns already; tolerate both. */
export function fromJson<T>(v: unknown): T {
  if (typeof v === "string") return JSON.parse(v) as T;
  return v as T;
}
