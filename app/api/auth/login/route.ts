import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, pruneSessions, sessionCookieOptions, verifyCredentials, SESSION_COOKIE } from "@/server/auth";
import { clientKey, rateLimited } from "@/server/rate-limit";

const LoginSchema = z.object({
  email: z.string().min(3).max(255),
  password: z.string().min(1).max(1024),
});

export async function POST(req: Request): Promise<NextResponse> {
  // e2e runs log in once per test; the limiter would trip mid-suite (never set in production)
  const e2e = process.env.E2E_TEST === "1";
  if (!e2e && rateLimited("login:" + clientKey(req), 5, 60_000))
    return NextResponse.json({ success: false, error: "Too many attempts — try again in a minute." }, { status: 429 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  // generic message — no user enumeration
  if (!user)
    return NextResponse.json({ success: false, error: "Invalid credentials." }, { status: 401 });

  const { token, expires } = await createSession(user.id);
  pruneSessions().catch(() => { /* opportunistic cleanup; never block login */ });

  const res = NextResponse.json({ success: true, data: { user } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
  return res;
}
