import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { getEmailPref, setEmailPref } from "@/server/mailer";

const PutSchema = z.object({ emailEnabled: z.boolean() }).strict();

/** GET /api/me/notification-prefs — the caller's own email opt-in. */
export const GET = withAuth(async (_req, user) => {
  const emailEnabled = await getEmailPref(user.id);
  return NextResponse.json({ success: true, data: { emailEnabled, channelActive: !!process.env.SMTP_URL } });
});

/** PUT /api/me/notification-prefs — flip the caller's own email opt-in. */
export const PUT = withAuth(async (req, user) => {
  const body = await parseBody(req, PutSchema);
  if (!body.ok) return body.res;
  await setEmailPref(user.id, body.data.emailEnabled);
  return NextResponse.json({ success: true, data: {} });
});
