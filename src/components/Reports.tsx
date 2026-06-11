"use client";

import { useMemo } from "react";
import { WI_STATES_ALL, type Item, type WiState } from "@/lib/engine";
import { burndown, burnup, cfd, velocity, wiCycleTimes } from "@/lib/reports";
import { areaPath, linePath, niceTicks, spanTicks, stackSeries, stepPath } from "@/lib/charts";
import { fmtDate } from "@/lib/format";
import { WI_STATES } from "./badges";

/* ---------------- REPORT CARDS ----------------
   Hand-rolled SVG in the same spirit as PlanVsActual / the dashboard LaneBar:
   no chart library, monospace axis labels, oklch tokens from globals.css.
   All data shaping is pure (src/lib/reports.ts + src/lib/charts.ts); the
   folds replay full event logs, so every card memoizes on its inputs. */

const W = 360, H = 150, PL = 34, PR = 10, PT = 10, PB = 20; // viewBox + padding

function Frame({ children }: { children: React.ReactNode }) {
  return <svg className="rep-svg" viewBox={`0 0 ${W} ${H}`} role="img">{children}</svg>;
}

function YAxis({ ticks, sy }: { ticks: number[]; sy: (v: number) => number }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line className="rep-grid" x1={PL} x2={W - PR} y1={sy(t)} y2={sy(t)} />
          <text className="rep-axis" x={PL - 5} y={sy(t) + 3} textAnchor="end">{t}</text>
        </g>
      ))}
    </g>
  );
}

function XAxis({ min, max, sx }: { min: number; max: number; sx: (ts: number) => number }) {
  return (
    <g>
      {spanTicks(min, max, 3).map((t, i, all) => (
        <text key={t + ":" + i} className="rep-axis" x={sx(t)} y={H - PB + 12}
          textAnchor={i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"}>{fmtDate(t)}</text>
      ))}
    </g>
  );
}

/* ---------------- 1. sprint burndown ---------------- */

export function BurndownCard({ items, sprint }: { items: Item[]; sprint: string | null }) {
  const series = useMemo(() => (sprint ? burndown(items, sprint) : []), [items, sprint]);

  const body = (() => {
    if (!sprint) return <div className="wi-empty">No sprint selected.</div>;
    if (series.length < 2) return <div className="wi-empty">Not enough history to chart {sprint} yet.</div>;
    const min = series[0].ts, max = series[series.length - 1].ts;
    const yTicks = niceTicks(Math.max(...series.map((p) => p.total)));
    const yTop = yTicks[yTicks.length - 1];
    const sx = (ts: number) => PL + ((ts - min) / (max - min)) * (W - PL - PR);
    const sy = (v: number) => H - PB - (v / yTop) * (H - PT - PB);
    return (
      <>
        <Frame>
          <YAxis ticks={yTicks} sy={sy} />
          <XAxis min={min} max={max} sx={sx} />
          <path d={linePath(series.map((p) => ({ x: sx(p.ts), y: sy(p.total) })))}
            fill="none" stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 3" />
          <path d={stepPath(series.map((p) => ({ x: sx(p.ts), y: sy(p.remaining) })))}
            fill="none" stroke="var(--accent)" strokeWidth={1.6} />
        </Frame>
        <div className="rep-legend mono">
          <span><span className="rep-leg-dot" style={{ background: "var(--accent)" }} />remaining</span>
          <span><span className="rep-leg-dot rep-leg-dash" />total scope</span>
          <span className="spacer"></span>
          <span>{series[series.length - 1].remaining}/{series[series.length - 1].total} pts left</span>
        </div>
      </>
    );
  })();

  return (
    <div className="card">
      <div className="card-h"><h3>Burndown</h3>
        <span className="mono rep-sub">{sprint ?? "—"}</span></div>
      <div className="card-b">{body}</div>
    </div>
  );
}

/* ---------------- 2. velocity ---------------- */

export function VelocityCard({ items, sprints }: { items: Item[]; sprints: string[] }) {
  const rows = useMemo(() => velocity(items, sprints), [items, sprints]);

  const body = (() => {
    if (!rows.length) return <div className="wi-empty">No sprints to compare yet.</div>;
    const yTicks = niceTicks(Math.max(...rows.map((r) => Math.max(r.committedPoints, r.donePoints))));
    const yTop = yTicks[yTicks.length - 1];
    const sy = (v: number) => H - PB - (v / yTop) * (H - PT - PB);
    const slot = (W - PL - PR) / rows.length;             // one slot per sprint
    const bw = Math.min(16, Math.max(3, slot * 0.28));    // bar width, paired
    return (
      <>
        <Frame>
          <YAxis ticks={yTicks} sy={sy} />
          {rows.map((r, i) => {
            const cx = PL + slot * (i + 0.5);
            return (
              <g key={r.sprint}>
                <rect x={cx - bw - 1} width={bw} y={sy(r.committedPoints)}
                  height={Math.max(0, sy(0) - sy(r.committedPoints))} fill="var(--border-2)" />
                <rect x={cx + 1} width={bw} y={sy(r.donePoints)}
                  height={Math.max(0, sy(0) - sy(r.donePoints))} fill="var(--ok)" />
                <text className="rep-axis" x={cx} y={H - PB + 12} textAnchor="middle">
                  {r.sprint.length > 9 ? r.sprint.slice(0, 8) + "…" : r.sprint}</text>
              </g>
            );
          })}
        </Frame>
        <div className="rep-legend mono">
          <span><span className="rep-leg-dot" style={{ background: "var(--border-2)" }} />committed</span>
          <span><span className="rep-leg-dot" style={{ background: "var(--ok)" }} />done</span>
        </div>
      </>
    );
  })();

  return (
    <div className="card">
      <div className="card-h"><h3>Velocity</h3>
        <span className="mono rep-sub">{rows.length} sprints</span></div>
      <div className="card-b">{body}</div>
    </div>
  );
}

/* ---------------- 3. cumulative flow ---------------- */

// stack bottom-up with done at the base (classic CFD reading order)
const CFD_ORDER: WiState[] = [...WI_STATES_ALL].reverse();

export function CfdCard({ items }: { items: Item[] }) {
  const { bands, min, max, yTop, yTicks } = useMemo(() => {
    const samples = cfd(items);
    const bands = stackSeries(samples, CFD_ORDER);
    const top = bands[bands.length - 1];
    const yMax = Math.max(0, ...top.band.map((p) => p.y1));
    const yTicks = niceTicks(yMax);
    return {
      bands,
      min: samples.length ? samples[0].ts : 0,
      max: samples.length ? samples[samples.length - 1].ts : 0,
      yTop: yTicks[yTicks.length - 1],
      yTicks,
    };
  }, [items]);

  const hasData = bands[0].band.length >= 2 && max > min;
  const sx = (ts: number) => PL + ((ts - min) / (max - min || 1)) * (W - PL - PR);
  const sy = (v: number) => H - PB - (v / yTop) * (H - PT - PB);

  return (
    <div className="card">
      <div className="card-h"><h3>Cumulative flow</h3>
        <span className="mono rep-sub">work items by state over time</span></div>
      <div className="card-b">
        {!hasData
          ? <div className="wi-empty">Not enough work-item history to chart flow yet.</div>
          : <>
              <Frame>
                <YAxis ticks={yTicks} sy={sy} />
                <XAxis min={min} max={max} sx={sx} />
                {bands.map(({ key, band }) => (
                  <path key={key} fillOpacity={0.7} fill={WI_STATES[key].color} stroke={WI_STATES[key].color} strokeWidth={0.5}
                    d={areaPath(
                      band.map((p) => ({ x: sx(p.ts), y: sy(p.y1) })),
                      band.map((p) => ({ x: sx(p.ts), y: sy(p.y0) })))} />
                ))}
              </Frame>
              <div className="rep-legend mono">
                {[...CFD_ORDER].reverse().map((s) => (
                  <span key={s}><span className="rep-leg-dot" style={{ background: WI_STATES[s].color }} />{WI_STATES[s].label}</span>
                ))}
              </div>
            </>}
      </div>
    </div>
  );
}

/* ---------------- 4. burnup ---------------- */

export function BurnupCard({ items, sprint }: { items: Item[]; sprint: string | null }) {
  const series = useMemo(() => (sprint ? burnup(items, sprint) : []), [items, sprint]);

  const body = (() => {
    if (!sprint) return <div className="wi-empty">No sprint selected.</div>;
    if (series.length < 2) return <div className="wi-empty">Not enough history to chart {sprint} yet.</div>;
    const min = series[0].ts, max = series[series.length - 1].ts;
    const yTicks = niceTicks(Math.max(...series.map((p) => p.total)));
    const yTop = yTicks[yTicks.length - 1];
    const sx = (ts: number) => PL + ((ts - min) / (max - min)) * (W - PL - PR);
    const sy = (v: number) => H - PB - (v / yTop) * (H - PT - PB);
    const last = series[series.length - 1];
    return (
      <>
        <Frame>
          <YAxis ticks={yTicks} sy={sy} />
          <XAxis min={min} max={max} sx={sx} />
          <path d={stepPath(series.map((p) => ({ x: sx(p.ts), y: sy(p.total) })))}
            fill="none" stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 3" />
          <path d={stepPath(series.map((p) => ({ x: sx(p.ts), y: sy(p.done) })))}
            fill="none" stroke="var(--ok)" strokeWidth={1.6} />
        </Frame>
        <div className="rep-legend mono">
          <span><span className="rep-leg-dot" style={{ background: "var(--ok)" }} />done</span>
          <span><span className="rep-leg-dot rep-leg-dash" />scope</span>
          <span className="spacer"></span>
          <span>{last.done}/{last.total} pts done</span>
        </div>
      </>
    );
  })();

  return (
    <div className="card">
      <div className="card-h"><h3>Burnup</h3>
        <span className="mono rep-sub">{sprint ?? "—"}</span></div>
      <div className="card-b">{body}</div>
    </div>
  );
}

/* ---------------- 5. control chart (cycle time) ---------------- */

const DAY_MS = 24 * 3600e3;

export function ControlChartCard({ items }: { items: Item[] }) {
  const done = useMemo(
    () => wiCycleTimes(items).filter((c) => c.cycleMs != null && c.doneTs != null)
      .sort((a, b) => a.doneTs! - b.doneTs!),
    [items],
  );

  const body = (() => {
    if (done.length < 2) return <div className="wi-empty">Fewer than two finished work items — no cycle-time trend yet.</div>;
    const min = done[0].doneTs!, max = done[done.length - 1].doneTs!;
    const days = (ms: number) => ms / DAY_MS;
    const yTicks = niceTicks(Math.max(...done.map((c) => days(c.cycleMs!))));
    const yTop = yTicks[yTicks.length - 1] || 1;
    const sx = (ts: number) => PL + ((ts - min) / (max - min || 1)) * (W - PL - PR);
    const sy = (v: number) => H - PB - (v / yTop) * (H - PT - PB);
    const mean = done.reduce((s, c) => s + days(c.cycleMs!), 0) / done.length;
    // rolling mean over the last 5 completions — the "trend" line of a Jira control chart
    const rolling = done.map((c, i) => {
      const win = done.slice(Math.max(0, i - 4), i + 1);
      return { ts: c.doneTs!, v: win.reduce((s, x) => s + days(x.cycleMs!), 0) / win.length };
    });
    return (
      <>
        <Frame>
          <YAxis ticks={yTicks} sy={sy} />
          <XAxis min={min} max={max} sx={sx} />
          <line className="rep-grid" x1={PL} x2={W - PR} y1={sy(mean)} y2={sy(mean)}
            stroke="var(--warn)" strokeDasharray="4 3" />
          <path d={linePath(rolling.map((p) => ({ x: sx(p.ts), y: sy(p.v) })))}
            fill="none" stroke="var(--accent)" strokeWidth={1.4} />
          {done.map((c) => (
            <circle key={c.wiId} cx={sx(c.doneTs!)} cy={sy(days(c.cycleMs!))} r={2.4}
              fill="var(--ok)" fillOpacity={0.8}>
              <title>{c.wiId} · {days(c.cycleMs!).toFixed(1)}d</title>
            </circle>
          ))}
        </Frame>
        <div className="rep-legend mono">
          <span><span className="rep-leg-dot" style={{ background: "var(--ok)" }} />cycle time</span>
          <span><span className="rep-leg-dot" style={{ background: "var(--accent)" }} />rolling avg</span>
          <span className="spacer"></span>
          <span>mean {mean.toFixed(1)}d · {done.length} done</span>
        </div>
      </>
    );
  })();

  return (
    <div className="card">
      <div className="card-h"><h3>Control chart</h3>
        <span className="mono rep-sub">cycle time per finished work item</span></div>
      <div className="card-b">{body}</div>
    </div>
  );
}
