import { useMemo } from "react";
import { formatMetricValue, formatDelta, formatRelativeShort, isImprovement, metricDirection } from "./format";
import type { ExperimentLite } from "./lineageTree";

type Props = {
  session: any;
  experiments: ExperimentLite[];
};

export function Frontier({ session, experiments }: Props) {
  const primaryMetric = String(session?.metricContract?.primaryMetric ?? "");
  const direction = metricDirection(session?.metricContract, primaryMetric);

  const trajectory = useMemo(() => {
    const completed = experiments
      .filter((e) => typeof e.metrics?.[primaryMetric] === "number")
      .sort((a, b) => a.ordinal - b.ordinal);

    let best: number | undefined;
    let bestOrdinal: number | undefined;
    let bestExperimentId: string | undefined;
    return completed.map((e) => {
      const v = e.metrics![primaryMetric] as number;
      const isFirst = best === undefined;
      const beats =
        isFirst ||
        (direction === "maximize" ? v > (best as number) : v < (best as number));
      if (beats) {
        best = v;
        bestOrdinal = e.ordinal;
        bestExperimentId = e._id;
      }
      return {
        ordinal: e.ordinal,
        value: v,
        runningBest: best as number,
        promoted: e.promoted,
        isHighWater: beats,
        isLatestBest: false,
        experimentId: e._id,
      };
    }).map((p) => ({
      ...p,
      isLatestBest: p.experimentId === bestExperimentId && p.ordinal === bestOrdinal,
    }));
  }, [experiments, primaryMetric, direction]);

  const highWaterPoints = trajectory.filter((p) => p.isHighWater);
  const bestPoint = highWaterPoints[highWaterPoints.length - 1];
  const previousBestPoint = highWaterPoints.slice(-2, -1)[0];
  const stalledSince = bestPoint
    ? trajectory.filter((p) => p.ordinal > bestPoint.ordinal).length
    : 0;
  const delta = bestPoint && previousBestPoint
    ? bestPoint.runningBest - previousBestPoint.runningBest
    : undefined;

  const empty = trajectory.length === 0 || !primaryMetric;

  return (
    <section className="frontier" aria-label="Frontier — primary metric trajectory">
      <div className="frontier-head">
        <span className="frontier-metric-name">
          {primaryMetric || "no primary metric"}
        </span>
        <span className="frontier-direction">{direction}</span>
      </div>

      <div className="frontier-row">
        <div className="frontier-value">
          {empty ? "—" : formatMetricValue(bestPoint?.runningBest)}
        </div>

        <div className="frontier-aside">
          {!empty && delta !== undefined ? (
            <div
              className={`frontier-delta ${
                isImprovement(delta, direction) ? "up" : delta === 0 ? "flat" : "down"
              }`}
            >
              {formatDelta(direction === "minimize" ? -delta : delta)} since prior best
            </div>
          ) : null}
          <div className="frontier-context">
            {empty
              ? "no completed experiments yet"
              : `best at #${bestPoint?.ordinal} · ${trajectory.length} measured`}
          </div>
        </div>

        {!empty ? (
          <Sparkline points={trajectory} />
        ) : null}
      </div>

      {!empty && stalledSince >= 3 ? (
        <div className="frontier-stalled">
          stalled — {stalledSince} experiments since last improvement
          {bestPoint
            ? ` (#${bestPoint.ordinal}${
                session?.updatedAtUtc ? ` · ${formatRelativeShort(session.updatedAtUtc)}` : ""
              })`
            : ""}
        </div>
      ) : null}
    </section>
  );
}

function Sparkline({
  points,
}: {
  points: Array<{
    ordinal: number;
    value: number;
    runningBest: number;
    promoted: boolean;
    isHighWater: boolean;
  }>;
}) {
  const W = 360;
  const H = 64;
  const padX = 6;
  const padY = 8;

  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const xs = points.map((_, i) =>
    points.length === 1 ? padX + innerW / 2 : padX + (i / (points.length - 1)) * innerW,
  );

  const allValues = points.flatMap((p) => [p.value, p.runningBest]);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = max - min || Math.abs(max) || 1;
  const yOf = (v: number) => padY + innerH - ((v - min) / span) * innerH;

  const bestPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xs[i]} ${yOf(p.runningBest)}`).join(" ");
  const valuePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xs[i]} ${yOf(p.value)}`).join(" ");

  return (
    <svg className="frontier-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="best-so-far trajectory">
      {/* raw experiment values, faint */}
      <path d={valuePath} fill="none" stroke="rgba(56, 38, 12, 0.18)" strokeWidth={1} />
      {/* running best (high-water mark) */}
      <path
        d={bestPath}
        fill="none"
        stroke="var(--amber)"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* dots: promoted moss, otherwise ink-3 */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={xs[i]}
          cy={yOf(p.value)}
          r={p.isHighWater ? 2.6 : 1.8}
          fill={p.promoted ? "var(--moss)" : p.isHighWater ? "var(--amber)" : "var(--ink-4)"}
        />
      ))}
    </svg>
  );
}
