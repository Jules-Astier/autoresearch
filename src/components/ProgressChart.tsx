import { useState } from "react";
import { TrendingUp } from "lucide-react";
import type { Experiment, SessionSnapshot } from "../types";
import { classNames, formatMetric } from "../utils/format";

type ProgressChartProps = {
  session: SessionSnapshot;
  metric: string;
  onMetricChange: (metric: string) => void;
};

type Point = {
  experiment: Experiment;
  value: number;
  index: number;
  x: number;
  y: number;
};

const VIEW_W = 800;
const VIEW_H = 280;
const PAD_L = 56;
const PAD_R = 24;
const PAD_T = 24;
const PAD_B = 36;

export function ProgressChart({ session, metric, onMetricChange }: ProgressChartProps) {
  const [hover, setHover] = useState<Point | null>(null);
  const metricNames = Array.from(
    new Set(session.experiments.flatMap((e) => Object.keys(e.metrics)))
  ).sort();
  const { points, min, max } = buildPoints(session.experiments, metric);
  const direction = String(session.metric_contract.metric_directions[metric] ?? "");

  const areaPath = points.length > 1
    ? `M ${points[0].x},${VIEW_H - PAD_B} L ${points.map((p) => `${p.x},${p.y}`).join(" L ")} L ${points[points.length - 1].x},${VIEW_H - PAD_B} Z`
    : "";
  const linePath = points.length > 0
    ? `M ${points.map((p) => `${p.x},${p.y}`).join(" L ")}`
    : "";

  return (
    <section className="min-w-0 rounded-lg border border-ink-800/70 bg-ink-900/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-800/80 ring-1 ring-ink-700/50">
            <TrendingUp className="h-3.5 w-3.5 text-ink-300" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-[13px] font-semibold text-ink-50">Progress</h2>
            <p className="text-[11px] text-ink-500">Metric trajectory across experiments</p>
          </div>
        </div>
        <select
          value={metric}
          onChange={(e) => onMetricChange(e.target.value)}
          className="h-8 rounded-md border border-ink-700 bg-ink-800/60 px-2.5 text-[12px] text-ink-100 focus:border-ink-500 focus:outline-none"
        >
          {metricNames.map((name) => (
            <option key={name} value={name} className="bg-ink-900">
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="relative mt-4 h-72 w-full">
        {points.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-ink-800 text-[12px] text-ink-500">
            No values for this metric.
          </div>
        ) : (
          <>
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" className="h-full w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="progressFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                const y = PAD_T + t * (VIEW_H - PAD_T - PAD_B);
                const v = max - t * (max - min);
                return (
                  <g key={t}>
                    <line x1={PAD_L} y1={y} x2={VIEW_W - PAD_R} y2={y} stroke="#27272a" strokeDasharray="2 4" />
                    <text x={PAD_L - 8} y={y + 3} textAnchor="end" className="fill-zinc-500 font-mono text-[10px]">
                      {formatMetric(v)}
                    </text>
                  </g>
                );
              })}

              {/* Area fill */}
              {areaPath ? <path d={areaPath} fill="url(#progressFill)" /> : null}

              {/* Line */}
              {linePath ? (
                <path d={linePath} fill="none" stroke="#a5b4fc" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
              ) : null}

              {/* Points */}
              {points.map((p) => (
                <g key={`${p.experiment.experiment_id || p.experiment.run_id}-${p.index}`}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={p.experiment.promoted ? 5 : 3.5}
                    fill={p.experiment.promoted ? "#10b981" : "#a5b4fc"}
                    stroke="#09090b"
                    strokeWidth="2"
                  />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="14"
                    fill="transparent"
                    onMouseEnter={() => setHover(p)}
                    onMouseLeave={() => setHover((h) => (h === p ? null : h))}
                    style={{ cursor: "pointer" }}
                  />
                </g>
              ))}

              {/* X axis labels */}
              <text x={PAD_L} y={VIEW_H - 10} className="fill-zinc-500 font-mono text-[10px]">first</text>
              <text x={VIEW_W - PAD_R} y={VIEW_H - 10} textAnchor="end" className="fill-zinc-500 font-mono text-[10px]">latest</text>
            </svg>

            {/* Tooltip */}
            {hover ? (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-ink-700 bg-ink-900/95 px-2.5 py-1.5 shadow-xl backdrop-blur"
                style={{
                  left: `${(hover.x / VIEW_W) * 100}%`,
                  top: `${(hover.y / VIEW_H) * 100}%`,
                  marginTop: -8
                }}
              >
                <div className="font-mono text-[10px] text-ink-400">
                  {hover.experiment.experiment_id || hover.experiment.run_id}
                </div>
                <div className="font-mono text-[12px] font-semibold tabular-nums text-ink-50">
                  {formatMetric(hover.value)}
                </div>
                {hover.experiment.promoted ? (
                  <div className="mt-0.5 text-[10px] font-medium text-emerald-400">promoted</div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-ink-800/60 pt-3 text-[11px] text-ink-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-300" /> trial
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> promoted
        </span>
        {direction ? (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-ink-500">
            {direction}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function buildPoints(experiments: Experiment[], metric: string) {
  const values = experiments
    .map((experiment, index) => ({ experiment, value: experiment.metrics[metric], index }))
    .filter((item): item is { experiment: Experiment; value: number; index: number } => typeof item.value === "number");

  if (values.length === 0) {
    return { points: [] as Point[], min: 0, max: 1 };
  }

  const min = Math.min(...values.map((v) => v.value));
  const max = Math.max(...values.map((v) => v.value));
  const span = max - min || Math.abs(max) || 1;
  const xSpan = values.length === 1 ? 1 : values.length - 1;
  const innerW = VIEW_W - PAD_L - PAD_R;
  const innerH = VIEW_H - PAD_T - PAD_B;

  const points = values.map((item, i) => ({
    experiment: item.experiment,
    value: item.value,
    index: item.index,
    x: PAD_L + (i / xSpan) * innerW,
    y: PAD_T + innerH - ((item.value - min) / span) * innerH
  }));

  return { points, min, max };
}
