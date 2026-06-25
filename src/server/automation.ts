/* Automation executor: runs after a command's event is appended (best-effort,
   fire-and-forget like notifications and webhooks). Rules subscribe by event
   type; an optional CQL condition is evaluated against the TRIGGERING work
   item's derived row; actions replay through the normal command path via
   applyCommandAsSystem, so flows and gates still apply.

   Loop prevention: events appended by automation carry actor "automation:…"
   and are ignored here — rule chains terminate after one hop. */
import { randomBytes } from "node:crypto";
import { deriveItem, type Item, type PdlcEvent } from "@/lib/engine";
import { parseCql, runCql, wiToCqlRow, type CqlQuery } from "@/lib/cql";
import { enabledRulesFor, recordRun, type AutomationAction, type AutomationRule } from "./repo/automations";
import { applyCommandAsSystem, getAllItems, getItem } from "./repo/items";
import { type Command, WiPatchSchema } from "./commands";

const AUTOMATION_ACTOR_PREFIX = "automation:";

/** Schedule trigger kind — rules that run on a tick instead of on an event. */
export const SCHEDULE_TRIGGER = "SCHEDULE";

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

/* ---------------- scheduled triggers (G-14 follow-up) ----------------
   A schedule rule has no triggering event; it runs against EVERY work item
   whose derived row matches its CQL condition (no condition = all WIs). An
   external cron hits POST /api/automations/tick to drive this. */

/** Pure: the (itemId, wiId) pairs a parsed schedule rule's condition selects.
 *  A null query matches every work item. */
export function scheduledMatches(
  items: Item[],
  query: CqlQuery | null,
): { itemId: string; wiId: string }[] {
  const out: { itemId: string; wiId: string }[] = [];
  for (const item of items)
    for (const wi of deriveItem(item).workItems) {
      if (query && runCql(query, [wiToCqlRow(item.id, wi)]).length === 0) continue;
      out.push({ itemId: item.id, wiId: wi.id });
    }
  return out;
}

/** Hard cap: prevent one no-condition rule from hammering the DB on large workspaces. */
const MAX_ACTIONS_PER_RULE_TICK = 500;

/** Run every enabled SCHEDULE rule once. Returns counts for the tick response.
 *  Automations execute as "PM" because only PMs can author rules — their effective
 *  authority mirrors the creating user's role. */
export async function runScheduledAutomations(): Promise<{ rules: number; actions: number }> {
  const rules = await enabledRulesFor(SCHEDULE_TRIGGER);
  if (!rules.length) return { rules: 0, actions: 0 };
  const items = (await getAllItems()).map((r) => r.item);
  let actionCount = 0;
  for (const rule of rules) {
    // unique ID per scheduled run — no real event exists for schedule triggers
    const eventId = `sched-${rule.id}-${Date.now()}-${randomBytes(4).toString("hex")}`;
    let query: CqlQuery | null = null;
    if (rule.cql) {
      const parsed = parseCql(rule.cql);
      if (!parsed.ok) { await recordRun(rule.id, eventId, false, `condition doesn't parse: ${parsed.error}`); continue; }
      query = parsed.query;
    }
    const matches = scheduledMatches(items, query);
    const actor = AUTOMATION_ACTOR_PREFIX + rule.name;
    const problems: string[] = [];
    let ruleActions = 0;
    let capped = false;
    // itemComment targets the item, not a work item — dedupe so it fires only
    // once per item per rule tick even when multiple work items match.
    const firedItemActions = new Set<string>();
    outer: for (const { itemId, wiId } of matches)
      for (const [ai, action] of rule.actions.entries()) {
        if (ruleActions >= MAX_ACTIONS_PER_RULE_TICK) {
          capped = true;
          break outer;
        }
        let dedupKey: string | undefined;
        if (action.kind === "itemComment") {
          dedupKey = `${itemId}:${ai}`;
          if (firedItemActions.has(dedupKey)) continue;
        }
        const cmd = toCommand(action, wiId);
        if (!cmd) continue;
        const out = await applyCommandAsSystem(itemId, cmd, actor, "PM");
        actionCount++;
        ruleActions++;
        if (out.status !== "ok")
          problems.push(`${itemId}/${wiId} ${action.kind}: ${out.status === "rejected" ? out.result.error : out.status}`);
        else if (dedupKey)
          firedItemActions.add(dedupKey);
      }
    const note = [
      problems.slice(0, 5).join(" · "),
      capped ? `capped at ${MAX_ACTIONS_PER_RULE_TICK} actions/tick` : "",
    ].filter(Boolean).join(" · ") || `applied to ${matches.length} work item(s)`;
    await recordRun(rule.id, eventId, problems.length === 0, note);
  }
  return { rules: rules.length, actions: actionCount };
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
