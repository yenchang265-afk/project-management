import { NextResponse } from "next/server";
import { z } from "zod";
import { ev, type Item } from "@/lib/engine";
import { withAuth } from "@/server/auth";
import { getAllItems, spawnChild } from "@/server/repo/items";

export const GET = withAuth(async () => {
  const rows = await getAllItems();
  return NextResponse.json({
    success: true,
    data: {
      items: rows.map((r) => r.item),
      versions: Object.fromEntries(rows.map((r) => [r.item.id, r.version])),
    },
  });
});

const SpawnSchema = z.object({
  spawnFrom: z.string().max(32),
  expectedVersion: z.number().int().min(0),
}).strict();

/** Spawn the next iteration of an item (PM-owned, same rule the UI enforced). */
export const POST = withAuth(async (req, user) => {
  if (user.role !== "PM")
    return NextResponse.json({ success: false, error: "Only PM can spawn the next iteration." }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }
  const parsed = SpawnSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });

  const { spawnFrom, expectedVersion } = parsed.data;
  const prefix = spawnFrom.split("-")[0];
  const childId = prefix + "-" + (500 + Math.floor(Math.random() * 480));

  const out = await spawnChild(spawnFrom, expectedVersion, childId, (parent: Item) => {
    const child: Item = {
      id: childId,
      title: parent.title.replace(/\s*\(iteration.*\)$/i, "") + " (next iteration)",
      area: parent.area, priority: "Medium", parent: parent.id, type: "feature",
      stakeholders: parent.stakeholders.map((s) => ({ ...s })),
      workItems: [],
      events: [ev(childId, "CREATE", user.name, user.role, { to: "backlog" })],
    };
    const parentEvent = ev(parent.id, "SPAWN_CHILD", user.name, user.role, { child: childId });
    return { child, parentEvent };
  });

  switch (out.status) {
    case "ok":
      return NextResponse.json({ success: true, data: { child: out.child, parentEvent: out.parentEvent, parentVersion: out.parentVersion } });
    case "stale":
      return NextResponse.json({ success: false, error: "stale", data: { item: out.item, version: out.version } }, { status: 409 });
    case "not_found":
      return NextResponse.json({ success: false, error: "Item not found." }, { status: 404 });
    case "error":
      return NextResponse.json({ success: false, error: out.message }, { status: 422 });
  }
});
