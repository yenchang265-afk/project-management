import { NextResponse } from "next/server";
import { z } from "zod";
import { STATES, deriveItem } from "@/lib/engine";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { requirePerm } from "@/server/permissions";
import { getItem } from "@/server/repo/items";
import { deleteVersion, getVersion, updateVersion, versionItemIds } from "@/server/repo/versions";

type Ctx = { params: Promise<{ id: string }> };

const PatchVersionSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  state: z.enum(["unreleased", "released", "archived"]).optional(),
}).strict();

const RELEASED_SPINE = STATES.released.spine!;

/** PATCH /api/versions/:id — PM only. Flipping state to `released` is GUARDED:
 *  every member item must be at or past `released` on the spine, otherwise a
 *  422 lists the stragglers — Jira's release button, wired to Cadence's gates. */
export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const guard = requirePerm(user, "manage_projects");
  if (guard) return guard;
  const { id } = await ctx.params;
  const body = await parseBody(req, PatchVersionSchema);
  if (!body.ok) return body.res;

  if (body.data.state === "released") {
    const ver = await getVersion(id);
    if (!ver) return NextResponse.json({ success: false, error: "Version not found." }, { status: 422 });
    const stragglers: string[] = [];
    for (const itemId of await versionItemIds(id)) {
      const loaded = await getItem(itemId);
      if (!loaded) continue;
      const spine = STATES[deriveItem(loaded.item).state].spine;
      if (spine == null || spine < RELEASED_SPINE) stragglers.push(itemId);
    }
    if (stragglers.length)
      return NextResponse.json({
        success: false,
        error: `Can't release ${ver.name}: ${stragglers.join(", ")} ${stragglers.length > 1 ? "are" : "is"} not released on the spine yet.`,
      }, { status: 422 });
  }

  const r = await updateVersion(id, {
    ...(body.data.name !== undefined ? { name: body.data.name.trim() } : {}),
    ...(body.data.releaseDate !== undefined ? { releaseDate: body.data.releaseDate } : {}),
    ...(body.data.state !== undefined ? { state: body.data.state } : {}),
  });
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});

/** DELETE /api/versions/:id — PM only; members fall back to no version. */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const guard = requirePerm(user, "manage_projects");
  if (guard) return guard;
  const { id } = await ctx.params;
  const r = await deleteVersion(id);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  return NextResponse.json({ success: true, data: {} });
});
