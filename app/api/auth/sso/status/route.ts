import { NextResponse } from "next/server";
import { ssoEnabled } from "@/server/sso";

/* GET /api/auth/sso/status — whether the SSO button should be shown. Public
   (the login page is pre-auth); reveals only a boolean, no config. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ success: true, data: { enabled: ssoEnabled() } });
}
