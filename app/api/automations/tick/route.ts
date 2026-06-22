import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runScheduledAutomations } from "@/server/automation";

/* POST /api/automations/tick — drives schedule-triggered automation rules.
   Meant for an external cron, NOT a browser: authenticated by a shared secret
   in AUTOMATION_TICK_SECRET (Authorization: Bearer <secret>), never the user
   session. Disabled (404) when the secret is unset, so it can't be probed in
   environments that don't opt in. */
export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.AUTOMATION_TICK_SECRET?.trim();
  if (!secret)
    return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });

  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const authBuf = Buffer.from(auth);
  const expBuf = Buffer.from(expected);
  if (authBuf.length !== expBuf.length || !timingSafeEqual(authBuf, expBuf))
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });

  try {
    const result = await runScheduledAutomations();
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Tick failed." }, { status: 500 });
  }
}
