import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { listAllSprints } from "@/server/repo/sprints";

/** GET /api/sprints — every team's sprints (read-only; feeds the calendar view).
 *  Sprint names/dates carry no per-team secrets, so any signed-in user may read,
 *  mirroring GET /api/structure. */
export const GET = withAuth(async () => {
  const sprints = await listAllSprints();
  return NextResponse.json({ success: true, data: { sprints } });
});
