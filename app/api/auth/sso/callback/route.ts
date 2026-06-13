import { NextRequest, NextResponse } from "next/server";
import { createSession, pruneSessions, sessionCookieOptions, SESSION_COOKIE } from "@/server/auth";
import {
  completeLogin, decodeState, emailFromClaims, findUserByEmail, ssoEnabled, SSO_STATE_COOKIE,
} from "@/server/sso";

/* GET /api/auth/sso/callback — complete the OIDC flow. openid-client verifies
   the id_token signature, state, and nonce; we map the verified email to an
   EXISTING user (no JIT provisioning), mint a normal session, and land on /.
   Failures redirect back to /login with a reason code, never leaking detail. */
function back(req: NextRequest, reason: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?sso=${reason}`, req.url));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!ssoEnabled()) return back(req, "disabled");

  const st = decodeState(req.cookies.get(SSO_STATE_COOKIE)?.value);
  if (!st) return back(req, "state");

  try {
    const claims = await completeLogin(new URL(req.url), st);
    const email = emailFromClaims(claims);
    if (!email) return back(req, "noemail");
    const user = await findUserByEmail(email);
    if (!user) return back(req, "nouser"); // SSO maps to existing accounts only

    const { token, expires } = await createSession(user.id);
    pruneSessions().catch(() => { /* opportunistic */ });
    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
    res.cookies.delete(SSO_STATE_COOKIE);
    return res;
  } catch {
    return back(req, "error");
  }
}
