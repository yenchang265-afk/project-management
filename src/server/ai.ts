/* AI suggestions (G-27, optional). Server-side only; every feature is gated
   behind ANTHROPIC_API_KEY and returns ADVISORY text — suggestions are never
   auto-applied. A human acts on them through the normal command path, so the
   engine's guards still hold. Prompt builders are pure (unit-tested); the
   model call is isolated in `ask`. */
import Anthropic from "@anthropic-ai/sdk";
import { SHIFT_LEFT, type Item, type WiComment } from "@/lib/engine";

const MODEL = "claude-opus-4-8";

export type AiKind = "comment_summary" | "risk_flags" | "sprint_narrative" | "assignment";

export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/* ---------------- pure prompt builders (testable) ---------------- */

export function buildCommentSummaryPrompt(comments: WiComment[]): { system: string; user: string } {
  const thread = comments.map((c) => `- ${c.author}: ${c.text}`).join("\n");
  return {
    system: "You summarize a work-item discussion thread for a busy product manager. Be concise: 2-4 bullet points capturing decisions, open questions, and blockers. No preamble.",
    user: `Summarize this comment thread:\n\n${thread || "(no comments)"}`,
  };
}

export function buildRiskPrompt(title: string, description: string): { system: string; user: string } {
  const risks = SHIFT_LEFT.map((r) => `${r.key} (${r.label})`).join(", ");
  return {
    system: `You flag delivery risks for a PDLC item. The available shift-left risk flags are: ${risks}. Suggest which flags likely apply and why, in one short line each. Only suggest — the PM decides. No preamble.`,
    user: `Item: ${title}\n\nDescription: ${description || "(none)"}`,
  };
}

export function buildSprintNarrativePrompt(stats: {
  sprint: string; committed: number; completed: number; spilled: number;
}): { system: string; user: string } {
  return {
    system: "You write a short sprint-review narrative for stakeholders. 2-3 sentences: what shipped, what slipped, and a forward note. Plain, factual, no fluff.",
    user: `Sprint "${stats.sprint}": committed ${stats.committed} points, completed ${stats.completed}, spilled ${stats.spilled}.`,
  };
}

export function buildAssignmentPrompt(
  title: string, description: string, candidates: { name: string; load: number }[]
): { system: string; user: string } {
  const roster = candidates.map((c) => `- ${c.name} (${c.load} open items)`).join("\n");
  return {
    system: "You suggest the best assignee for a work item, balancing current load. Name one person and give a one-line reason. It is only a suggestion. No preamble.",
    user: `Work item: ${title}\n${description ? `Details: ${description}\n` : ""}\nTeam (with current load):\n${roster}`,
  };
}

/* ---------------- model call (isolated, env-gated) ---------------- */

async function ask(prompt: { system: string; user: string }): Promise<string> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  } as Anthropic.MessageCreateParamsNonStreaming);
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export async function aiCommentSummary(comments: WiComment[]): Promise<string> {
  return ask(buildCommentSummaryPrompt(comments));
}
export async function aiRiskFlags(item: Pick<Item, "title"> & { description?: string }): Promise<string> {
  return ask(buildRiskPrompt(item.title, item.description ?? ""));
}
export async function aiSprintNarrative(stats: { sprint: string; committed: number; completed: number; spilled: number }): Promise<string> {
  return ask(buildSprintNarrativePrompt(stats));
}
export async function aiAssignment(title: string, description: string, candidates: { name: string; load: number }[]): Promise<string> {
  return ask(buildAssignmentPrompt(title, description, candidates));
}
