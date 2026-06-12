import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimited } from "@/server/rate-limit";
import { formByToken } from "@/server/repo/forms";
import { applyCommandAsSystem } from "@/server/repo/items";

type Ctx = { params: Promise<{ token: string }> };

const SubmitSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5_000).optional(),
  requester: z.string().max(120).optional(),
}).strict();

/* Deliberately UNAUTHENTICATED: the unguessable form token is the credential.
   In-memory rate limit per token (resets on server restart — dev-grade). */
const INTAKE_MAX = 10;
const INTAKE_WINDOW_MS = 5 * 60_000;

/** POST /api/intake/:token — public intake. Files a `story` in todo, tagged
 *  `intake`, on the form's target item via the NORMAL command path (system
 *  actor) — flows and validation still apply. Responses leak nothing about
 *  the workspace; invalid tokens and disabled forms both read as 404. */
export async function POST(req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!/^[0-9a-f]{48}$/.test(token))
    return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  if (rateLimited("intake:" + token, INTAKE_MAX, INTAKE_WINDOW_MS))
    return NextResponse.json({ success: false, error: "Too many submissions — try again later." }, { status: 429 });

  const form = await formByToken(token);
  if (!form) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }
  const parsed = SubmitSchema.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json({ success: false, error: "Invalid submission." }, { status: 400 });

  const actor = `intake:${form.name}`;
  const created = await applyCommandAsSystem(form.itemId, {
    kind: "wiCreate",
    draft: { type: "story", title: parsed.data.title.trim(), assignee: "", state: "todo", tags: ["intake"] },
  }, actor, "PM");
  if (created.status !== "ok")
    return NextResponse.json({ success: false, error: "Submission failed." }, { status: 422 });

  const note = [
    parsed.data.description?.trim(),
    parsed.data.requester?.trim() ? `— submitted by ${parsed.data.requester.trim()}` : null,
  ].filter(Boolean).join("\n\n");
  if (note && created.event.wiId)
    await applyCommandAsSystem(form.itemId, {
      kind: "wiUpdate", wiId: created.event.wiId, patch: { description: note },
    }, actor, "PM");

  return NextResponse.json({ success: true, data: { received: true } });
}
