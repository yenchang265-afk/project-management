/* Repository: API tokens. The plaintext token exists only in the create
   response — the table stores its SHA-256. Lookup hashes the presented
   token and matches the unique hash column. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Role } from "@/lib/engine";
import { pool } from "../db";

export type TokenScope = "read" | "write";

export interface TokenInfo {
  id: string;
  name: string;
  scope: TokenScope;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface TokenUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  scope: TokenScope;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function iso(v: unknown): string | null {
  return v == null ? null : new Date(v as string | Date).toISOString();
}

export async function listTokens(userId: string): Promise<TokenInfo[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, name, scope, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at, id",
    [userId]);
  return rows.map((r) => ({
    id: r.id, name: r.name, scope: r.scope as TokenScope,
    createdAt: iso(r.created_at)!, lastUsedAt: iso(r.last_used_at),
  }));
}

/** Mint a token. The returned `token` is the ONLY copy of the plaintext. */
export async function createToken(
  userId: string, name: string, scope: TokenScope,
): Promise<{ id: string; token: string }> {
  const id = "tok-" + randomUUID();
  const token = "cad_" + randomBytes(32).toString("base64url");
  await pool().query(
    "INSERT INTO api_tokens (id, user_id, name, token_hash, scope) VALUES (?, ?, ?, ?, ?)",
    [id, userId, name, sha256(token), scope]);
  return { id, token };
}

/** Owner-only revoke: someone else's id behaves like a missing row. */
export async function revokeToken(id: string, userId: string): Promise<boolean> {
  const [r] = await pool().query<ResultSetHeader>(
    "DELETE FROM api_tokens WHERE id = ? AND user_id = ?", [id, userId]);
  return r.affectedRows > 0;
}

/** Resolve a presented bearer token to its user (null = invalid/revoked).
 *  Touches last_used_at fire-and-forget — auth must not block on it. */
export async function tokenUser(token: string): Promise<TokenUser | null> {
  const [rows] = await pool().query<RowDataPacket[]>(
    `SELECT t.id AS token_id, t.scope, u.id, u.email, u.name, u.role
       FROM api_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ?`, [sha256(token)]);
  const r = rows[0];
  if (!r) return null;
  void pool().query("UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?", [r.token_id])
    .catch(() => { /* best-effort */ });
  return { id: r.id, email: r.email, name: r.name, role: r.role as Role, scope: r.scope as TokenScope };
}
