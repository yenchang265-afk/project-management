import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { CommandRequestSchema } from "@/server/commands";
import { notifyAfterCommand } from "@/server/notify";
import { applyCommand, getItem } from "@/server/repo/items";
import { getScope, itemInScope } from "@/server/scope";

type Ctx = { params: Promise<{ id: string }> };

/** THE mutation endpoint: validate intent, run the engine server-side, append the event. */
export const POST = withAuth<Ctx>(async (req, user, ctx) => {
  const { id } = await ctx.params;

  // access gate: out-of-scope items are 404 (can't read, can't mutate)
  const [found, scope] = await Promise.all([getItem(id), getScope(user)]);
  if (!found || !itemInScope(found.item.project ?? null, scope))
    return NextResponse.json({ success: false, error: "Item not found." }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }
  const parsed = CommandRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ success: false, error: "Invalid command." }, { status: 400 });

  // actor identity comes from the session — never from the request body
  const out = await applyCommand(id, parsed.data.expectedVersion, parsed.data.command, user.name, user.role);

  switch (out.status) {
    case "ok":
      // best-effort fan-out: watchers/@mentions — never blocks or fails the command
      void notifyAfterCommand(found.item, out.event);
      return NextResponse.json({ success: true, data: { event: out.event, version: out.version } });
    case "stale":
      return NextResponse.json({ success: false, error: "stale", data: { item: out.item, version: out.version } }, { status: 409 });
    case "rejected":
      return NextResponse.json({ success: false, error: out.result.error, data: { rejection: out.result.rejection ?? null } }, { status: 422 });
    case "not_found":
      return NextResponse.json({ success: false, error: "Item not found." }, { status: 404 });
  }
});
