/* =========================================================================
   Project summary — pure folds for the per-project landing view.
   The caller pre-filters items to one project; everything here is derived
   from the event log via deriveItem (no React/DOM/DB).
   ========================================================================= */

import {
  STATES, TRANSITIONS, deriveItem, gateStatus,
  type GateKey, type Item, type Lane, type StateKey,
} from "./engine";

export interface SummaryGateRow {
  itemId: string;
  title: string;
  state: StateKey;
  gate: GateKey;
  blocking: number;       // unsatisfied required conditions
  pmSigned: boolean;
  devSigned: boolean;
  open: boolean;
}

export interface SummarySprintRow {
  name: string;
  total: number;
  done: number;
  points: number;     // committed story points
  donePoints: number;
}

export interface SummaryActivityRow {
  itemId: string;
  type: string;
  actor: string;
  ts: number;
}

export interface ProjectSummary {
  laneSpread: Record<Lane, number>;
  gates: SummaryGateRow[];
  sprints: SummarySprintRow[];
  activity: SummaryActivityRow[];
  totals: { items: number; workItems: number; doneWis: number };
}

const ACTIVITY_CAP = 15;

export function projectSummary(items: Item[]): ProjectSummary {
  const laneSpread: Record<Lane, number> = { discovery: 0, build: 0, verify: 0, release: 0, closed: 0, off: 0 };
  const gates: SummaryGateRow[] = [];
  const bySprint = new Map<string, SummarySprintRow>();
  const activity: SummaryActivityRow[] = [];
  let workItems = 0, doneWis = 0;

  for (const item of items) {
    const snap = deriveItem(item);
    laneSpread[STATES[snap.state].lane]++;

    // first gated forward step from the current state (the gate the item is heading into)
    const gatedNext = TRANSITIONS.find((t) => t.from === snap.state && t.gate);
    if (gatedNext?.gate) {
      const g = gateStatus(gatedNext.gate, snap);
      gates.push({
        itemId: item.id, title: item.title, state: snap.state, gate: gatedNext.gate,
        blocking: g.blocking.length,
        pmSigned: !!g.signoff.PM, devSigned: !!g.signoff.Dev,
        open: g.open,
      });
    }

    for (const w of snap.workItems) {
      workItems++;
      const done = w.state === "done";
      if (done) doneWis++;
      if (!w.sprint) continue;
      const row = bySprint.get(w.sprint) || { name: w.sprint, total: 0, done: 0, points: 0, donePoints: 0 };
      const next = {
        ...row,
        total: row.total + 1,
        done: row.done + (done ? 1 : 0),
        points: row.points + (w.storyPoints || 0),
        donePoints: row.donePoints + (done ? w.storyPoints || 0 : 0),
      };
      bySprint.set(w.sprint, next);
    }

    for (const e of item.events)
      activity.push({ itemId: item.id, type: e.type, actor: e.actor, ts: e.ts });
  }

  activity.sort((a, b) => b.ts - a.ts);

  return {
    laneSpread,
    gates,
    sprints: Array.from(bySprint.values()).sort((a, b) => a.name.localeCompare(b.name)),
    activity: activity.slice(0, ACTIVITY_CAP),
    totals: { items: items.length, workItems, doneWis },
  };
}
