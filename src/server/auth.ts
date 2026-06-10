import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import bcrypt from "bcryptjs";
import type { Role } from "@/lib/engine";
import { pool } from "./db";
import { env } from "./env";

export const SESSION_COOKIE = "cadence_session";
const SESSION_DAYS = 7;
const RENEW_BELOW_DAYS = 6; // sliding window: extend when less than this remains

export interface AuthedUser { id: string; email: string; name: string; role: Role; }

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/* ---------- credentials ---------- */
export async function verifyCredentials(email: string, password: string): Promise<AuthedUser | null> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, email, name, role, password_hash FROM users WHERE email = ?", [email]);
  const u = rows[0];
  // constant-shape: always run a bcrypt compare so missing users cost the same time
  const hash = u ? (u.password_hash as string) : "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
  const ok = await bcrypt.compare(password, hash);
  if (!u || !ok) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role as Role };
}

/* ---------- sessions ---------- */
export async function createSession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3);
  await pool().query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    [sha256(token), userId, expires]);
  return { token, expires };
}

export async function destroySession(token: string): Promise<void> {
  await pool().query("DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
}

export async function sessionUser(token: string): Promise<AuthedUser | null> {
  const [rows] = await pool().query<RowDataPacket[]>(
    `SELECT u.id, u.email, u.name, u.role, s.expires_at, s.token_hash
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > NOW()`, [sha256(token)]);
  const r = rows[0];
  if (!r) return null;
  // sliding expiry: renew when the window has meaningfully shrunk
  const remainMs = new Date(r.expires_at).getTime() - Date.now();
  if (remainMs < RENEW_BELOW_DAYS * 86400e3) {
    await pool().query("UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
      [new Date(Date.now() + SESSION_DAYS * 86400e3), r.token_hash]);
  }
  return { id: r.id, email: r.email, name: r.name, role: r.role as Role };
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().NODE_ENV === "production",
    path: "/",
    expires,
  };
}

/* ---------- route guard ---------- */
export async function currentUser(): Promise<AuthedUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return sessionUser(token);
}

type Handler<C> = (req: Request, user: AuthedUser, ctx: C) => Promise<NextResponse>;

/** Wrap a route handler: 401 envelope unless a valid session is present.
 *  Unexpected throws become a generic 500 — details go to the server log only. */
export function withAuth<C>(handler: Handler<C>) {
  return async (req: Request, ctx: C): Promise<NextResponse> => {
    const user = await currentUser();
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated." }, { status: 401 });
    try {
      return await handler(req, user, ctx);
    } catch (e) {
      console.error("[api] unhandled error:", e instanceof Error ? e.stack : e);
      return NextResponse.json({ success: false, error: "Internal error." }, { status: 500 });
    }
  };
}

/** Periodic cleanup of expired sessions; cheap enough to run opportunistically. */
export async function pruneSessions(): Promise<void> {
  const [r] = await pool().query<ResultSetHeader>("DELETE FROM sessions WHERE expires_at <= NOW()");
  void r;
}
