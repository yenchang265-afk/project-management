/* SSO via OIDC (G-28, opt-in). Disabled unless all four OIDC_* env vars are
   set, so password auth (verifyCredentials) is the untouched default. The
   authorization-code + PKCE flow, id_token signature verification, and
   state/nonce checks are handled by `openid-client` — no hand-rolled crypto.
   We map the verified id_token email to an EXISTING users row (no JIT
   provisioning); unknown emails are rejected.

   Live verification requires a real IdP; the pure helpers below (config gate,
   claim→email mapping, state-cookie encode/decode) are unit-tested. */
import { createHmac, timingSafeEqual } from "node:crypto";
import type * as OpenIdClient from "openid-client";
import type { RowDataPacket } from "mysql2/promise";
import type { Role } from "@/lib/engine";
import { pool } from "./db";
import type { AuthedUser } from "./auth";

export interface SsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Read the OIDC env vars; null (feature disabled) unless all four are present. */
export function ssoConfig(): SsoConfig | null {
  const issuer = process.env.OIDC_ISSUER?.trim();
  const clientId = process.env.OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.OIDC_CLIENT_SECRET?.trim();
  const redirectUri = process.env.OIDC_REDIRECT_URI?.trim();
  if (!issuer || !clientId || !clientSecret || !redirectUri) return null;
  return { issuer, clientId, clientSecret, redirectUri };
}

export function ssoEnabled(): boolean {
  return ssoConfig() !== null;
}

/**
 * Pure: extract a usable email from verified id_token claims. Returns null when
 * there is no email or the provider explicitly marked it unverified — we never
 * trust an unverified address to resolve an account.
 */
export function emailFromClaims(claims: Record<string, unknown>): string | null {
  const email = claims.email;
  if (typeof email !== "string" || !email.includes("@")) return null;
  // Require explicit verification — absent claim is treated as unverified (OIDC Core §5.1)
  if (claims.email_verified !== true) return null;
  return email.trim().toLowerCase();
}

/* ---------- short-lived signed state cookie (login → callback) ---------- */

export interface SsoState { state: string; nonce: string; codeVerifier: string; }

function sign(payload: string): string {
  // SESSION_SECRET is validated at startup by env(); read it directly here so
  // the cookie helpers don't drag in the full env schema (and stay testable).
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Encode the PKCE/state/nonce triple as `base64(json).sig` for an httpOnly cookie. */
export function encodeState(s: SsoState): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Decode + verify a state cookie; null on any tampering or malformed input. */
export function decodeState(cookie: string | undefined): SsoState | null {
  if (!cookie) return null;
  const parts = cookie.split(".");
  // Reject cookies with anything other than exactly one dot (payload.sig).
  // split('.', 2) silently discards trailing content, which would let an
  // attacker append arbitrary data to a valid cookie and still pass verification.
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = sign(payload);
  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (sigBuf.byteLength !== expectedBuf.byteLength) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as SsoState;
    if (!parsed.state || !parsed.nonce || !parsed.codeVerifier) return null;
    return parsed;
  } catch { return null; }
}

export const SSO_STATE_COOKIE = "cadence_sso";

/* ---------- openid-client integration (live; needs a real IdP) ---------- */

let _discovery: Promise<OpenIdClient.Configuration> | null = null;

/** Memoized OIDC discovery for the configured issuer. openid-client is loaded
 *  lazily so the ESM dependency stays out of the pre-auth status path.
 *  A rejected promise is cleared so the next call retries instead of
 *  permanently breaking SSO until the server restarts. */
export async function ssoDiscovery(): Promise<OpenIdClient.Configuration> {
  const cfg = ssoConfig();
  if (!cfg) throw new Error("SSO is not configured.");
  if (!_discovery) {
    // Assign synchronously before any await so concurrent callers share this
    // promise instead of each starting a redundant discovery fetch.
    _discovery = import("openid-client")
      .then((client) => client.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret))
      .catch((e) => { _discovery = null; throw e; });
  }
  return _discovery;
}

/** Build the authorize URL and the state triple to stash in the cookie. */
export async function beginLogin(): Promise<{ url: URL; state: SsoState }> {
  const cfg = ssoConfig();
  if (!cfg) throw new Error("SSO is not configured.");
  const client = await import("openid-client");
  const config = await ssoDiscovery();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: cfg.redirectUri,
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  return { url, state: { state, nonce, codeVerifier } };
}

/** Complete the code exchange and return the verified id_token claims. */
export async function completeLogin(currentUrl: URL, st: SsoState): Promise<Record<string, unknown>> {
  const client = await import("openid-client");
  const config = await ssoDiscovery();
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: st.codeVerifier,
    expectedState: st.state,
    expectedNonce: st.nonce,
  });
  return tokens.claims() as Record<string, unknown>;
}

/** Resolve an existing user by email (no JIT provisioning). */
export async function findUserByEmail(email: string): Promise<AuthedUser | null> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT id, email, name, role FROM users WHERE email = ?", [email]);
  const u = rows[0];
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role as Role };
}
