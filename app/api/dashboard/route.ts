import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { getDashboardPrefs, setDashboardPrefs } from "@/server/repo/dashboard";

const PutSchema = z.object({
  gadgets: z.array(z.string().min(1).max(40)).max(20),
}).strict();

/** GET /api/dashboard — the caller's gadget list (null = default layout). */
export const GET = withAuth(async (_req, user) => {
  const gadgets = await getDashboardPrefs(user.id);
  return NextResponse.json({ success: true, data: { gadgets } });
});

/** PUT /api/dashboard — replace the caller's gadget list. */
export const PUT = withAuth(async (req, user) => {
  const body = await parseBody(req, PutSchema);
  if (!body.ok) return body.res;
  await setDashboardPrefs(user.id, body.data.gadgets);
  return NextResponse.json({ success: true, data: {} });
});
