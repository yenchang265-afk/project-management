/* Automation executor: runs after a command's event is appended (best-effort,
   fire-and-forget like notifications and webhooks). Rules subscribe by event
   type; an optional CQL condition is evaluated against the TRIGGERING work
   item's derived row; actions replay through the normal command path via
   applyCommandAsSystem, so flows and gates still apply.

   Loop prevention: events appended by automation carry actor "automation:…"
   and are ignored here — rule chains terminate after one hop. */
import { deriveItem, type PdlcEvent } from "@/lib/engine";
import { parseCql, runCql, wiToCqlRow } from "@/lib/cql";
import { enabledRulesFor, recordRun, type AutomationAction, type AutomationRule } from "./repo/automations";
import { applyCommandAsSystem, getItem } from "./repo/items";
import { type Command, WiPatchSchema } from "./commands";

const AUTOMATION_ACTOR_PREFIX = "automation:";

function toCommand(action: AutomationAction, wiId: string | undefined): Command | null {
  switch (action.kind) {
    case "wiMove":
      return wiId ? ({ kind: "wiMove", wiId, to: action.to } as Command) : null;
    case "wiComment":
      return wiId ? ({ kind: "wiComment", wiId, text: action.text } as Command) : null;
    case "itemComment":
      return { kind: "item_comment", text: action.text } as Command;
    case "wiUpdate": {
      if (!wiId) return null;
      const patch = WiPatchSchema.safeParse(action.patch);
      if (!patch.success) return null;
      return { kind: "wiUpdate", wiId, patch: patch.data } as Command;
    }
  }
}

async function runRule(rule: AutomationRule, itemId: string, event: PdlcEvent): Promise<void> {
  // condition: evaluated on the post-event snapshot of the triggering WI
  if (rule.cql) {
    if (!event.wiId) { await recordRun(rule.id, event.id, true, "skipped: no work item on event"); return; }
    const loaded = await getItem(itemId);
    if (!loaded) return;
    const wi = deriveItem(loaded.item).workItems.find((w) => w.id === event.wiId);
    if (!wi) { await recordRun(rule.id, event.id, true, "skipped: work item gone"); return; }
    const parsed = parseCql(rule.cql);
    if (!parsed.ok) { await recordRun(rule.id, event.id, false, `condition doesn't parse: ${parsed.error}`); return; }
    if (runCql(parsed.query, [wiToCqlRow(itemId, wi)]).length === 0) {
      await recordRun(rule.id, event.id, true, "skipped: condition not met");
      return;
    }
  }

  const actor = AUTOMATION_ACTOR_PREFIX + rule.name;
  const results: string[] = [];
  let allOk = true;
  for (const action of rule.actions) {
    const cmd = toCommand(action, event.wiId);
    if (!cmd) { results.push(`${action.kind}: skipped (needs a work-item event)`); continue; }
    const out = await applyCommandAsSystem(itemId, cmd, actor, "PM");
    if (out.status === "ok") results.push(`${action.kind}: ok`);
    else {
      allOk = false;
      results.push(`${action.kind}: ${out.status === "rejected" ? out.result.error : out.status}`);
    }
  }
  await recordRun(rule.id, event.id, allOk, results.join(" · ") || "no applicable actions");
}

/** Entry point — callers `void` this; it must never throw into the route. */
export async function runAutomation(itemId: string, event: PdlcEvent): Promise<void> {
  try {
    if (event.actor.startsWith(AUTOMATION_ACTOR_PREFIX)) return; // one hop only
    const rules = await enabledRulesFor(event.type);
    for (const rule of rules) {
      try { await runRule(rule, itemId, event); }
      catch (e) { await recordRun(rule.id, event.id, false, e instanceof Error ? e.message : "executor error").catch(() => {}); }
    }
  } catch { /* best-effort — never disturb the command response */ }
}
