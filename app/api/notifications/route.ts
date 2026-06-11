import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { listNotifications, markRead } from "@/server/repo/notifications";

/** Own notifications only — userId always comes from the session. ?unread=1 filters. */
export const GET = withAuth(async (req, user) => {
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";
  const notifications = await listNotifications(user.id, { unreadOnly });
  return NextResponse.json({ success: true, data: { notifications } });
});

const ReadSchema = z.object({
  op: z.literal("read"),
  ids: z.array(z.string().max(64)).max(500).optional(), // omitted = mark all read
}).strict();

export const POST = withAuth(async (req, user) => {
  const parsed = await parseBody(req, ReadSchema);
  if (!parsed.ok) return parsed.res;
  await markRead(user.id, parsed.data.ids ?? "all");
  return NextResponse.json({ success: true, data: {} });
});
