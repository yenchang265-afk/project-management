import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import {
  aiAssignment, aiCommentSummary, aiEnabled, aiRiskFlags, aiSprintNarrative,
} from "@/server/ai";

/* POST /api/ai/suggest — advisory AI suggestions (G-27). Authenticated; gated
   behind ANTHROPIC_API_KEY (404 when unset). Suggestions are returned as text
   and never auto-applied — the user acts via the normal command path. Inputs
   are data the caller already sees in the UI. */

const CommentItem = z.object({ id: z.string(), author: z.string(), role: z.enum(["PM", "Dev"]), ts: z.number(), text: z.string() });

const SuggestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("comment_summary"), comments: z.array(CommentItem).max(200) }).strict(),
  z.object({ kind: z.literal("risk_flags"), title: z.string().min(1).max(200), description: z.string().max(4000).optional() }).strict(),
  z.object({ kind: z.literal("sprint_narrative"), sprint: z.string().min(1).max(80), committed: z.number(), completed: z.number(), spilled: z.number() }).strict(),
  z.object({ kind: z.literal("assignment"), title: z.string().min(1).max(200), description: z.string().max(4000).optional(),
    candidates: z.array(z.object({ name: z.string(), load: z.number() })).min(1).max(50) }).strict(),
]);

export const POST = withAuth(async (req) => {
  if (!aiEnabled())
    return NextResponse.json({ success: false, error: "AI suggestions are not configured." }, { status: 404 });

  const body = await parseBody(req, SuggestSchema);
  if (!body.ok) return body.res;

  try {
    let text: string;
    switch (body.data.kind) {
      case "comment_summary": text = await aiCommentSummary(body.data.comments); break;
      case "risk_flags": text = await aiRiskFlags({ title: body.data.title, description: body.data.description }); break;
      case "sprint_narrative": text = await aiSprintNarrative(body.data); break;
      case "assignment": text = await aiAssignment(body.data.title, body.data.description ?? "", body.data.candidates); break;
    }
    return NextResponse.json({ success: true, data: { text } });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "AI request failed." }, { status: 502 });
  }
});
