import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { runBulkOps } from "@/server/bulk";
import { BulkRequestSchema } from "@/server/commands";
import { requirePerm } from "@/server/permissions";

/** Bulk mutation: 1..50 single-route commands applied sequentially.
 *  Always 200 with a per-op results array — partial success is expected;
 *  the client reconciles by refetching items. */
export const POST = withAuth(async (req, user) => {
  const denied = requirePerm(user, "bulk_commands");
  if (denied) return denied;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }
  const parsed = BulkRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ success: false, error: "Invalid bulk request." }, { status: 400 });

  const results = await runBulkOps(user, parsed.data.ops);
  return NextResponse.json({ success: true, data: { results } });
});
