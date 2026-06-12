import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { requirePerm } from "@/server/permissions";
import { listAuditEvents } from "@/server/repo/audit";

/** GET /api/audit?actor=&type=&item=&beforeSeq=&limit= — global audit log
 *  (PM only). Newest first; pass the last row's seq as beforeSeq to page. */
export const GET = withAuth(async (req, user) => {
  const guard = requirePerm(user, "view_audit");
  if (guard) return guard;
  const p = new URL(req.url).searchParams;
  const beforeRaw = p.get("beforeSeq");
  const beforeSeq = beforeRaw != null && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : undefined;
  const limitRaw = p.get("limit");
  const limit = limitRaw != null && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined;
  const events = await listAuditEvents({
    actor: p.get("actor")?.trim() || undefined,
    type: p.get("type")?.trim() || undefined,
    itemId: p.get("item")?.trim() || undefined,
    beforeSeq,
    limit,
  });
  return NextResponse.json({ success: true, data: { events } });
});
