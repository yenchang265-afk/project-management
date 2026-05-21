// Tiny inline-SVG burndown line chart. Deliberately dependency-free — we render
// a server component with a fixed viewBox so it scales responsively without a
// charting library. Two lines: ideal (linear) and actual.

import type { ReactElement } from 'react';

export type BurndownPoint = { date: string; remaining: number };

const WIDTH = 600;
const HEIGHT = 200;
const PAD = 24;

export function Burndown({ series }: { series: BurndownPoint[] }): ReactElement {
  if (series.length === 0) {
    return (
      <div className="rounded border bg-white p-4 text-sm text-gray-500" data-testid="burndown">
        No burndown data yet.
      </div>
    );
  }

  const maxRemaining = Math.max(1, ...series.map((p) => p.remaining));
  const innerW = WIDTH - PAD * 2;
  const innerH = HEIGHT - PAD * 2;
  const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;

  function ptToXY(i: number, value: number): { x: number; y: number } {
    const x = PAD + i * stepX;
    const y = PAD + innerH - (value / maxRemaining) * innerH;
    return { x, y };
  }

  const actualPath = series
    .map((p, i) => {
      const { x, y } = ptToXY(i, p.remaining);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const startRemaining = series[0]!.remaining;
  const idealPath = series
    .map((_p, i) => {
      const ideal =
        series.length > 1
          ? startRemaining - (i * startRemaining) / (series.length - 1)
          : startRemaining;
      const { x, y } = ptToXY(i, ideal);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="rounded border bg-white p-4" data-testid="burndown">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-48 w-full"
        role="img"
        aria-label="Burndown chart"
      >
        {/* Axes */}
        <line
          x1={PAD}
          y1={HEIGHT - PAD}
          x2={WIDTH - PAD}
          y2={HEIGHT - PAD}
          stroke="#cbd5e1"
          strokeWidth={1}
        />
        <line x1={PAD} y1={PAD} x2={PAD} y2={HEIGHT - PAD} stroke="#cbd5e1" strokeWidth={1} />
        {/* Ideal */}
        <path d={idealPath} fill="none" stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1.5} />
        {/* Actual */}
        <path d={actualPath} fill="none" stroke="#2563eb" strokeWidth={2} />
        {/* Dots */}
        {series.map((p, i) => {
          const { x, y } = ptToXY(i, p.remaining);
          return <circle key={p.date} cx={x} cy={y} r={3} fill="#2563eb" />;
        })}
        {/* Labels */}
        <text x={PAD} y={PAD - 8} fontSize={10} fill="#64748b">
          {maxRemaining}
        </text>
        <text x={PAD} y={HEIGHT - 8} fontSize={10} fill="#64748b">
          0
        </text>
      </svg>
      <ul className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-600 md:grid-cols-6">
        {series.map((p) => (
          <li key={p.date} data-testid={`burndown-day-${p.date}`}>
            <span className="font-mono">{p.date.slice(5)}</span>: {p.remaining}
          </li>
        ))}
      </ul>
    </div>
  );
}
