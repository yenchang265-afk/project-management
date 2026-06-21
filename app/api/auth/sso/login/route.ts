import { NextResponse } from "next/server";
import { beginLogin, encodeState, ssoEnabled, SSO_STATE_COOKIE } from "@/server/sso";

/* GET /api/auth/sso/login — start the OIDC authorization-code flow. Stashes the
   PKCE verifier + state + nonce in a short-lived signed httpOnly cookie and
   redirects to the IdP. 404 when SSO isn't configured. */
export async function GET(): Promise<NextResponse> {
  if (!ssoEnabled())
    return NextResponse.json({ success: false, error: "SSO is not configured." }, { status: 404 });
  try {
    const { url, state } = await beginLogin();
    const res = NextResponse.redirect(url.href);
    res.cookies.set(SSO_STATE_COOKIE, encodeState(state), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600, // 10 minutes — the login round-trip
    });
    return res;
  } catch {
    return NextResponse.json(
      { success: false, error: "SSO initiation failed." }, { status: 502 });
  }
}
