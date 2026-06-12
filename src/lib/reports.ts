/* =========================================================================
   REPORTING — pure folds over the work-item event log. No React, no DOM,
   no DB. Same philosophy as the analytics in engine.ts: replay events
   chronologically and derive every chart series from the log.

   Shared core: a tiny WI simulator that mirrors deriveItem's WI_* folding
   (baseline workItems + WI_CREATE / WI_UPDATE / WI_DELETE, null = clear,
   delete = tombstone) while ALSO remembering history the live snapshot
   throws away (sprints a WI was ever in, first in_progress / latest done).
   ========================================================================= */

import type { Item, PdlcEvent, WiState, WorkItem } from "./engine";
import { WI_STATES_ALL } from "./engine";

/* ---------- shared replay core ---------- */

interface WiSim {
  wiId: string;
  itemId: string;
  title: string;
  state: WiState;
  storyPoints?: number;
  sprint?: string;
  deleted: boolean;
  everSprints: Set<string>;   // every sprint string the WI ever carried
  startTs: number | null;     // ts of FIRST entry into in_progress
  lastDoneTs: number | null;  // ts of LATEST entry into done
}

interface Timeline {
  sims: Map<string, WiSim>;                     // key = itemId + "\n" + wiId
  events: { e: PdlcEvent; itemId: string }[];   // WI_* events, ts-sorted
}

const key = (itemId: string, wiId: string) => itemId + "\n" + wiId;
const points = (s: WiSim) => s.storyPoints ?? 1; // default 1 when unset

function baselineSim(itemId: string, w: WorkItem): WiSim {
  const sim: WiSim = {
    wiId: w.id,
    itemId,
    title: w.title,
    state: w.state,
    deleted: false,
    everSprints: new Set<string>(),
    startTs: null,    // baseline WIs carry no timestamps — unknown start/done
    lastDoneTs: null,
  };
  if (w.storyPoints != null) sim.storyPoints = w.storyPoints;
  if (w.sprint != null) {
    sim.sprint = w.sprint;
    sim.everSprints.add(w.sprint);
  }
  return sim;
}

/** Baseline workItems + all WI_* events of all items, merged and ts-sorted. */
function buildTimeline(items: Item[]): Timeline {
  const sims = new Map<string, WiSim>();
  const events: Timeline["events"] = [];
  for (const it of items) {
    for (const w of it.workItems || []) sims.set(key(it.id, w.id), baselineSim(it.id, w));
    for (const e of it.events)
      if (e.type === "WI_CREATE" || e.type === "WI_UPDATE" || e.type === "WI_DELETE")
        events.push({ e, itemId: it.id });
  }
  events.sort((a, b) => a.e.ts - b.e.ts); // out-of-order appends are sorted, like deriveItem
  return { sims, events };
}

function enterState(sim: WiSim, state: WiState, ts: number): void {
  sim.state = state;
  if (state === "in_progress" && sim.startTs == null) sim.startTs = ts;
  if (state === "done") sim.lastDoneTs = ts;
}

/** Fold one WI event into the sim map — mirrors deriveItem's WI handling. */
function applyWiEvent(sims: Map<string, WiSim>, itemId: string, e: PdlcEvent): void {
  if (!e.wiId) return;
  const k = key(itemId, e.wiId);
  const cur = sims.get(k);
  switch (e.type) {
    case "WI_CREATE": {
      if (cur && !cur.deleted) return; // already live — deriveItem ignores too
      const p = e.wi || {};
      const sim: WiSim = {
        wiId: e.wiId,
        itemId,
        title: p.title ?? "",
        state: "todo",
        deleted: false,
        everSprints: new Set<string>(),
        startTs: null,
        lastDoneTs: null,
      };
      if (p.storyPoints != null) sim.storyPoints = p.storyPoints;
      if (p.sprint != null) {
        sim.sprint = p.sprint;
        sim.everSprints.add(p.sprint);
      }
      enterState(sim, (p.state as WiState) || "todo", e.ts);
      sims.set(k, sim);
      return;
    }
    case "WI_UPDATE": {
      if (!cur || cur.deleted) return;
      const p = e.wi || {};
      if (p.title != null) cur.title = p.title;
      if (p.state != null && p.state !== cur.state) enterState(cur, p.state as WiState, e.ts);
      if ("storyPoints" in p) cur.storyPoints = p.storyPoints == null ? undefined : p.storyPoints;
      if ("sprint" in p) {
        cur.sprint = p.sprint == null ? undefined : p.sprint;
        if (cur.sprint) cur.everSprints.add(cur.sprint);
      }
      return;
    }
    case "WI_DELETE":
      if (cur) cur.deleted = true; // tombstone — never counted again
      return;
  }
}

/* ---------- 1. burndown ---------- */

export interface BurndownPoint {
  ts: number;
  remaining: number; // points of not-done WIs currently in the sprint
  total: number;     // points of ALL WIs currently in the sprint
}

/** Sprint burndown: remaining vs total story points (default 1/WI) folded
 *  chronologically. Emits a point at every event ts that changes the picture;
 *  with a `range`, the series is anchored at range.start and range.end. */
export function burndown(
  items: Item[],
  sprint: string,
  range?: { start: number; end: number },
): BurndownPoint[] {
  const { sims, events } = buildTimeline(items);
  const calc = (): { remaining: number; total: number } => {
    let remaining = 0, total = 0;
    for (const s of sims.values()) {
      if (s.deleted || s.sprint !== sprint) continue;
      const p = points(s);
      total += p;
      if (s.state !== "done") remaining += p;
    }
    return { remaining, total };
  };

  const out: BurndownPoint[] = [];
  const push = (ts: number, v: { remaining: number; total: number }) => {
    const last = out[out.length - 1];
    if (last && last.ts === ts) { last.remaining = v.remaining; last.total = v.total; }
    else out.push({ ts, remaining: v.remaining, total: v.total });
  };

  let i = 0;
  if (range) {
    // fold everything up to the window, anchor at start, sample changes, anchor at end
    for (; i < events.length && events[i].e.ts <= range.start; i++)
      applyWiEvent(sims, events[i].itemId, events[i].e);
    push(range.start, calc());
    let prev = calc();
    for (; i < events.length && events[i].e.ts <= range.end; i++) {
      applyWiEvent(sims, events[i].itemId, events[i].e);
      const v = calc();
      if (v.remaining !== prev.remaining || v.total !== prev.total) {
        push(events[i].e.ts, v);
        prev = v;
      }
    }
    push(range.end, calc());
    return out;
  }

  if (!events.length) return [];
  let prev = calc(); // baseline picture before any event
  for (const { e, itemId } of events) {
    applyWiEvent(sims, itemId, e);
    const v = calc();
    if (v.remaining !== prev.remaining || v.total !== prev.total) {
      push(e.ts, v);
      prev = v;
    }
  }
  if (out.length) push(events[events.length - 1].e.ts, prev); // close the series at the last event
  return out;
}

/* ---------- 1b. burnup ---------- */

export interface BurnupPoint {
  ts: number;
  done: number;  // points of done WIs currently in the sprint
  total: number; // scope: points of ALL WIs currently in the sprint
}

/** Sprint burnup: done vs total scope — the same fold as burndown, read
 *  from the other side (done = total - remaining). Surfaces scope growth. */
export function burnup(
  items: Item[],
  sprint: string,
  range?: { start: number; end: number },
): BurnupPoint[] {
  return burndown(items, sprint, range).map((p) => ({ ts: p.ts, done: p.total - p.remaining, total: p.total }));
}

/* ---------- 2. velocity ---------- */

export interface VelocityRow {
  sprint: string;
  donePoints: number;      // points of WIs CURRENTLY done in the sprint (derive-time)
  committedPoints: number; // points of all WIs EVER in the sprint (incl. moved out / deleted)
}

export function velocity(items: Item[], sprints: string[]): VelocityRow[] {
  const { sims, events } = buildTimeline(items);
  for (const { e, itemId } of events) applyWiEvent(sims, itemId, e);
  return sprints.map((sprint) => {
    let donePoints = 0, committedPoints = 0;
    for (const s of sims.values()) {
      const p = points(s);
      if (s.everSprints.has(sprint)) committedPoints += p;
      if (!s.deleted && s.sprint === sprint && s.state === "done") donePoints += p;
    }
    return { sprint, donePoints, committedPoints };
  });
}

/* ---------- 3. cumulative flow diagram ---------- */

export interface CfdSample {
  ts: number;
  counts: Record<WiState, number>; // live (non-tombstoned) WIs per state
}

const zeroCounts = (): Record<WiState, number> =>
  Object.fromEntries(WI_STATES_ALL.map((s) => [s, 0])) as Record<WiState, number>;

/** WI count per state sampled at event timestamps, bucketed down to at most
 *  `buckets` evenly spaced samples across the event span (default 30). */
export function cfd(items: Item[], buckets = 30): CfdSample[] {
  const { sims, events } = buildTimeline(items);
  if (!events.length) return [];

  const distinct = [...new Set(events.map(({ e }) => e.ts))]; // already ts-sorted
  let samples: number[];
  if (distinct.length <= buckets || buckets < 2) {
    samples = buckets < 2 ? [distinct[distinct.length - 1]] : distinct;
  } else {
    const min = distinct[0], max = distinct[distinct.length - 1];
    samples = Array.from({ length: buckets }, (_, k) =>
      Math.round(min + ((max - min) * k) / (buckets - 1)));
  }

  const out: CfdSample[] = [];
  let i = 0;
  for (const ts of samples) {
    while (i < events.length && events[i].e.ts <= ts) {
      applyWiEvent(sims, events[i].itemId, events[i].e);
      i++;
    }
    const counts = zeroCounts();
    for (const s of sims.values()) if (!s.deleted) counts[s.state]++;
    out.push({ ts, counts });
  }
  return out;
}

/* ---------- 3b. sprint report ---------- */

export interface SprintReportWi {
  wiId: string;
  itemId: string;
  title: string;
  points: number;
  state: WiState;
}

export interface SprintReport {
  completed: SprintReportWi[]; // in the sprint and done
  open: SprintReportWi[];      // in the sprint, not done
  spilled: SprintReportWi[];   // EVER in the sprint, now moved out or deleted
  committedPoints: number;     // points of everything ever in the sprint
  completedPoints: number;
}

/** Jira "sprint report": committed vs completed vs spilled, derived from the
 *  everSprints history the live snapshot throws away. */
export function sprintReport(items: Item[], sprint: string): SprintReport {
  const { sims, events } = buildTimeline(items);
  for (const { e, itemId } of events) applyWiEvent(sims, itemId, e);
  const completed: SprintReportWi[] = [], open: SprintReportWi[] = [], spilled: SprintReportWi[] = [];
  let committedPoints = 0, completedPoints = 0;
  for (const s of sims.values()) {
    if (!s.everSprints.has(sprint)) continue;
    const p = points(s);
    committedPoints += p;
    const row: SprintReportWi = { wiId: s.wiId, itemId: s.itemId, title: s.title, points: p, state: s.state };
    if (!s.deleted && s.sprint === sprint && s.state === "done") { completed.push(row); completedPoints += p; }
    else if (!s.deleted && s.sprint === sprint) open.push(row);
    else spilled.push(row);
  }
  return { completed, open, spilled, committedPoints, completedPoints };
}

/* ---------- 3c. created vs resolved ---------- */

export interface CreatedResolvedPoint {
  ts: number;
  created: number;  // live (non-tombstoned) WIs existing at ts
  resolved: number; // of those, currently done at ts
}

/** Net created vs resolved counts sampled like the CFD (at most `buckets`
 *  evenly spaced samples). Reopening drops resolved; deleting drops both. */
export function createdVsResolved(items: Item[], buckets = 30): CreatedResolvedPoint[] {
  return cfd(items, buckets).map((s) => {
    const created = Object.values(s.counts).reduce((a, b) => a + b, 0);
    return { ts: s.ts, created, resolved: s.counts.done };
  });
}

/* ---------- 4. cycle times ---------- */

export interface WiCycleTime {
  wiId: string;
  itemId: string;
  title: string;       // derive-time title
  startTs: number | null; // first entry into in_progress (null = never started)
  doneTs: number | null;  // LATEST entry into done — null unless currently done
  cycleMs: number | null; // doneTs - startTs when both known
}

/** Per live WI: first in_progress ts → latest done ts. A reopened WI counts
 *  as unfinished again until it re-enters done. Tombstoned WIs are excluded. */
export function wiCycleTimes(items: Item[]): WiCycleTime[] {
  const { sims, events } = buildTimeline(items);
  for (const { e, itemId } of events) applyWiEvent(sims, itemId, e);
  const out: WiCycleTime[] = [];
  for (const s of sims.values()) {
    if (s.deleted) continue;
    const doneTs = s.state === "done" ? s.lastDoneTs : null;
    const cycleMs = s.startTs != null && doneTs != null ? doneTs - s.startTs : null;
    out.push({ wiId: s.wiId, itemId: s.itemId, title: s.title, startTs: s.startTs, doneTs, cycleMs });
  }
  return out;
}
