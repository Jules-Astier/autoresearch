import { useEffect, useMemo, useRef, useState } from "react";
import { ListChecks, Minus, Plus, ScanSearch } from "lucide-react";
import {
  formatMetricValue,
  formatDelta,
  formatRelativeShort,
  isImprovement,
  metricDirection,
  topObjectiveMetric,
} from "./format";
import type { ExperimentLite } from "./lineageTree";
import { experimentSourceCount } from "./sources";

type Props = {
  session: any;
  experiments: ExperimentLite[];
  onSelectExperiment?: (experimentId: string) => void;
};

type Point = {
  ordinal: number;
  value: number;
  runningBest: number;
  metrics: Record<string, number>;
  promoted: boolean;
  isHighWater: boolean;
  experimentId: string;
  sourceCount: number;
};

type MetricOption = {
  name: string;
  direction: "maximize" | "minimize";
  measured: number;
};

const DEFAULT_PX = 44;
const MIN_PX = 10;
const MAX_PX = 160;
const CHART_PLOT_H = 220;
const CHART_SCROLL_GUTTER = 16;
const CHART_H = CHART_PLOT_H + CHART_SCROLL_GUTTER;
const CHART_PAD_TOP = 18;
const CHART_PAD_BOTTOM = 28;

export function Frontier({ session, experiments, onSelectExperiment }: Props) {
  const topObjective = topObjectiveMetric(session?.metricContract);
  const direction = metricDirection(session?.metricContract, topObjective);

  const trajectory: Point[] = useMemo(() => {
    const completed = experiments
      .filter((e) => typeof e.metrics?.[topObjective] === "number")
      .sort((a, b) => a.ordinal - b.ordinal);

    let best: number | undefined;
    return completed.map((e) => {
      const v = e.metrics![topObjective] as number;
      const beats =
        best === undefined ||
        (direction === "maximize" ? v > best : v < best);
      if (beats) best = v;
      return {
        ordinal: e.ordinal,
        value: v,
        runningBest: best as number,
        metrics: e.metrics ?? {},
        promoted: e.promoted,
        isHighWater: beats,
        experimentId: e._id,
        sourceCount: experimentSourceCount(e.sources),
      };
    });
  }, [experiments, topObjective, direction]);

  const highWaterPoints = trajectory.filter((p) => p.isHighWater);
  const bestPoint = highWaterPoints[highWaterPoints.length - 1];
  const previousBestPoint = highWaterPoints.slice(-2, -1)[0];
  const stalledSince = bestPoint
    ? trajectory.filter((p) => p.ordinal > bestPoint.ordinal).length
    : 0;
  const delta =
    bestPoint && previousBestPoint
      ? bestPoint.runningBest - previousBestPoint.runningBest
      : undefined;

  const empty = trajectory.length === 0 || !topObjective;
  const sourcedMeasured = trajectory.filter((point) => point.sourceCount > 0).length;
  const extraMetricOptions: MetricOption[] = useMemo(() => {
    const names = new Set<string>();
    const contractMetrics = Array.isArray(session?.metricContract?.metrics)
      ? session.metricContract.metrics
      : [];
    for (const metric of contractMetrics) {
      if (metric?.name) names.add(String(metric.name));
    }
    for (const experiment of experiments) {
      for (const [name, value] of Object.entries(experiment.metrics ?? {})) {
        if (typeof value === "number" && Number.isFinite(value)) names.add(name);
      }
    }
    names.delete(topObjective);
    return [...names]
      .map((name) => ({
        name,
        direction: metricDirection(session?.metricContract, name),
        measured: experiments.filter(
          (experiment) =>
            typeof experiment.metrics?.[name] === "number" &&
            Number.isFinite(experiment.metrics[name]),
        ).length,
      }))
      .filter((metric) => metric.measured > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [experiments, session?.metricContract, topObjective]);
  const [selectedExtraMetrics, setSelectedExtraMetrics] = useState<string[]>([]);

  useEffect(() => {
    const valid = new Set(extraMetricOptions.map((metric) => metric.name));
    setSelectedExtraMetrics((selected) =>
      selected.filter((metricName) => valid.has(metricName)),
    );
  }, [extraMetricOptions]);

  return (
    <section className="frontier" aria-label="Frontier - top objective trajectory">
      <div className="frontier-head">
        <span className="frontier-metric-name">
          {topObjective || "no objective"}
        </span>
        <span className="frontier-direction">{direction}</span>
      </div>

      <div className="frontier-row">
        <div className="frontier-value">
          {empty ? "—" : formatMetricValue(bestPoint?.runningBest)}
        </div>
        <div className="frontier-aside">
          {!empty && delta !== undefined && stalledSince === 0 ? (
            <div
              className={`frontier-delta ${isImprovement(delta, direction) ? "up" : delta === 0 ? "flat" : "down"
                }`}
            >
              {formatDelta(direction === "minimize" ? -delta : delta)} since prior best
            </div>
          ) : null}
          <div className="frontier-context">
            {empty
              ? "no completed experiments yet"
              : `best at #${bestPoint?.ordinal} · ${trajectory.length} measured${
                sourcedMeasured > 0 ? ` · ${sourcedMeasured} sourced` : ""
              }`}
          </div>
        </div>
      </div>

      {!empty && stalledSince >= 3 ? (
        <div className="frontier-stalled">
          stalled — {stalledSince} experiment{stalledSince === 1 ? "" : "s"} since last improvement
          {bestPoint
            ? ` (#${bestPoint.ordinal}${session?.updatedAtUtc ? ` · ${formatRelativeShort(session.updatedAtUtc)}` : ""
            })`
            : ""}
        </div>
      ) : null}

      {!empty ? (
        <Chart
          points={trajectory}
          direction={direction}
          extraMetricOptions={extraMetricOptions}
          selectedExtraMetrics={selectedExtraMetrics}
          onToggleExtraMetric={(metricName) => {
            setSelectedExtraMetrics((selected) =>
              selected.includes(metricName)
                ? selected.filter((name) => name !== metricName)
                : [...selected, metricName],
            );
          }}
          onSelect={onSelectExperiment}
        />
      ) : null}
    </section>
  );
}

function Chart({
  points,
  direction,
  extraMetricOptions,
  selectedExtraMetrics,
  onToggleExtraMetric,
  onSelect,
}: {
  points: Point[];
  direction: "maximize" | "minimize";
  extraMetricOptions: MetricOption[];
  selectedExtraMetrics: string[];
  onToggleExtraMetric: (metricName: string) => void;
  onSelect?: (experimentId: string) => void;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ point: Point; left: number; top: number } | null>(null);
  const [pxPerPoint, setPxPerPoint] = useState<number>(DEFAULT_PX);
  const [logScale, setLogScale] = useState<boolean>(false);
  const [metricMenuOpen, setMetricMenuOpen] = useState<boolean>(false);
  const selectedMetricSet = useMemo(
    () => new Set(selectedExtraMetrics),
    [selectedExtraMetrics],
  );
  const selectedMetricOptions = extraMetricOptions.filter((metric) =>
    selectedMetricSet.has(metric.name),
  );

  // log requires all positive values; if any are <= 0 we silently fall back
  const overlayValues = selectedExtraMetrics.flatMap((metricName) =>
    points
      .map((point) => point.metrics[metricName])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  );
  const canLog = points.every((p) => p.value > 0 && p.runningBest > 0) && overlayValues.every((value) => value > 0);
  const useLog = logScale && canLog;
  const tx = (v: number) => (useLog ? Math.log10(v) : v);

  // bounds — include both raw values and the running best
  const allValues = points
    .flatMap((p) => [p.value, p.runningBest, ...selectedExtraMetrics.map((name) => p.metrics[name])])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map(tx);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = max - min || Math.abs(max) || 1;

  const innerH = CHART_PLOT_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const yOf = (v: number) => CHART_PAD_TOP + innerH - ((tx(v) - min) / span) * innerH;

  // chart width — at least viewport width, but wider if there are many points
  const minVisible = 20;
  const baseWidth = Math.max(points.length, minVisible) * pxPerPoint;

  const xOf = (i: number) => 24 + i * pxPerPoint;

  // axis ticks — 5 evenly spaced y values
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const v = max - t * (max - min);
    // when log scale, invert back for display label
    return useLog ? Math.pow(10, v) : v;
  });

  // pin to right (latest) on mount and when data length changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [points.length, pxPerPoint, logScale]);

  useEffect(() => {
    const chartEl = chartRef.current;
    const scrollEl = scrollRef.current;
    if (!chartEl || !scrollEl) return;
    const gestureEl = chartEl;
    const scroller = scrollEl;
    let pointerInChart = false;
    let touchStartedInChart = false;
    let pageScrollLocked = false;

    const maxScrollLeft = () => Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const clampScrollLeft = (v: number) => Math.min(maxScrollLeft(), Math.max(0, v));
    const eventStartedInChart = (target: EventTarget | null) => target instanceof Node && gestureEl.contains(target);
    const syncPageScrollLock = () => {
      const shouldLock = pointerInChart || touchStartedInChart;
      if (shouldLock === pageScrollLocked) return;
      pageScrollLocked = shouldLock;
      document.documentElement.classList.toggle("lab-frontier-scroll-locked", shouldLock);
      document.body.classList.toggle("lab-frontier-scroll-locked", shouldLock);
    };
    const wheelPixels = (e: WheelEvent) => {
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller.clientWidth : 1;
      const dominantDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      return dominantDelta * unit;
    };

    function handleWheel(e: WheelEvent) {
      if (!pointerInChart && !eventStartedInChart(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (maxScrollLeft() <= 0) return;
      scroller.scrollLeft = clampScrollLeft(scroller.scrollLeft + wheelPixels(e));
    }

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartScrollLeft = 0;

    function handlePointerEnter() {
      pointerInChart = true;
      syncPageScrollLock();
    }

    function handlePointerLeave() {
      pointerInChart = false;
      syncPageScrollLock();
    }

    function handleTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      touchStartedInChart = eventStartedInChart(e.target);
      if (!touchStartedInChart) return;
      e.stopPropagation();
      syncPageScrollLock();
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartScrollLeft = scroller.scrollLeft;
    }

    function handleTouchMove(e: TouchEvent) {
      if (!touchStartedInChart || e.touches.length !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      if (maxScrollLeft() <= 0) return;

      const dx = touchStartX - e.touches[0].clientX;
      const dy = touchStartY - e.touches[0].clientY;
      scroller.scrollLeft = clampScrollLeft(touchStartScrollLeft + (Math.abs(dx) >= Math.abs(dy) ? dx : dy));
    }

    function handleTouchEnd() {
      touchStartedInChart = false;
      syncPageScrollLock();
    }

    gestureEl.addEventListener("pointerenter", handlePointerEnter);
    gestureEl.addEventListener("pointerleave", handlePointerLeave);
    gestureEl.addEventListener("pointercancel", handlePointerLeave);
    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    window.addEventListener("touchstart", handleTouchStart, { passive: false, capture: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false, capture: true });
    window.addEventListener("touchend", handleTouchEnd, { capture: true });
    window.addEventListener("touchcancel", handleTouchEnd, { capture: true });

    return () => {
      pageScrollLocked = true;
      pointerInChart = false;
      touchStartedInChart = false;
      syncPageScrollLock();
      gestureEl.removeEventListener("pointerenter", handlePointerEnter);
      gestureEl.removeEventListener("pointerleave", handlePointerLeave);
      gestureEl.removeEventListener("pointercancel", handlePointerLeave);
      window.removeEventListener("wheel", handleWheel, { capture: true });
      window.removeEventListener("touchstart", handleTouchStart, { capture: true });
      window.removeEventListener("touchmove", handleTouchMove, { capture: true });
      window.removeEventListener("touchend", handleTouchEnd, { capture: true });
      window.removeEventListener("touchcancel", handleTouchEnd, { capture: true });
    };
  }, []);

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(p.value)}`).join(" ");
  const bestPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(p.runningBest)}`).join(" ");
  const overlaySeries = selectedMetricOptions
    .map((metric, metricIndex) => {
      const segments: string[] = [];
      let drawing = false;
      points.forEach((point, pointIndex) => {
        const value = point.metrics[metric.name];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          drawing = false;
          return;
        }
        segments.push(`${drawing ? "L" : "M"} ${xOf(pointIndex)} ${yOf(value)}`);
        drawing = true;
      });
      return {
        ...metric,
        color: extraMetricColor(metricIndex),
        path: segments.join(" "),
      };
    })
    .filter((series) => series.path.length > 0);
  const totalWidth = baseWidth + 24;

  // x-axis ordinal labels — sparse, density-aware
  const labelEvery = pxPerPoint < 20 ? 10 : pxPerPoint < 36 ? 5 : 2;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round((px - 24) / pxPerPoint);
    if (i < 0 || i >= points.length) {
      setHover(null);
      return;
    }
    const p = points[i];
    const scrollRect = scrollRef.current!.getBoundingClientRect();
    setHover({
      point: p,
      left: e.clientX - scrollRect.left,
      top: yOf(p.value),
    });
  }

  function zoomIn() {
    setPxPerPoint((v) => Math.min(MAX_PX, Math.round(v * 1.4)));
  }
  function zoomOut() {
    setPxPerPoint((v) => Math.max(MIN_PX, Math.round(v / 1.4)));
  }
  function zoomReset() {
    setPxPerPoint(DEFAULT_PX);
  }

  return (
    <div className="frontier-chart" ref={chartRef} aria-label="objective and metric chart">
      <div className="frontier-chart-yaxis">
        <svg width={56} height={CHART_H}>
          {yTicks.map((tickValue, i) => (
            <g key={i}>
              <text
                x={48}
                y={CHART_PAD_TOP + (i / (yTicks.length - 1)) * innerH + 4}
                textAnchor="end"
                fontFamily="var(--face-mono)"
                fontSize={11}
                fill="var(--ink-3)"
              >
                {formatMetricValue(tickValue)}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="frontier-chart-scroll" ref={scrollRef}>
        <svg
          width={totalWidth}
          height={CHART_H}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => {
            if (hover && onSelect) onSelect(hover.point.experimentId);
          }}
          style={{ cursor: hover ? "pointer" : "default" }}
        >
          {/* horizontal grid lines */}
          {yTicks.map((_t, i) => {
            const y = CHART_PAD_TOP + (i / (yTicks.length - 1)) * innerH;
            return (
              <line
                key={i}
                x1={0}
                y1={y}
                x2={totalWidth}
                y2={y}
                stroke="rgba(56, 38, 12, 0.08)"
                strokeDasharray="3 4"
              />
            );
          })}

          {/* raw value path — faint */}
          <path d={path} fill="none" stroke="rgba(56, 38, 12, 0.22)" strokeWidth={1.25} />

          {/* optional metric overlays */}
          {overlaySeries.map((series) => (
            <path
              key={series.name}
              d={series.path}
              fill="none"
              stroke={series.color}
              strokeWidth={1.6}
              strokeDasharray="5 5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* high-water line */}
          <path
            d={bestPath}
            fill="none"
            stroke="var(--amber)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* dots */}
          {points.map((p, i) => {
            const isHovered = hover?.point.experimentId === p.experimentId;
            return (
              <g key={p.experimentId}>
                {p.isHighWater ? (
                  <circle cx={xOf(i)} cy={yOf(p.runningBest)} r={3.5} fill="var(--amber)" />
                ) : null}
                {p.sourceCount > 0 ? (
                  <circle
                    cx={xOf(i)}
                    cy={yOf(p.value)}
                    r={6}
                    fill="none"
                    stroke="var(--moss)"
                    strokeWidth={1}
                    opacity={0.85}
                  />
                ) : null}
                <circle
                  cx={xOf(i)}
                  cy={yOf(p.value)}
                  r={isHovered ? 4.5 : p.promoted ? 3.5 : 2.5}
                  fill={p.promoted ? "var(--moss)" : p.isHighWater ? "var(--amber)" : "var(--ink-4)"}
                  stroke={isHovered ? "var(--ink-1)" : "transparent"}
                  strokeWidth={isHovered ? 1.5 : 0}
                />
              </g>
            );
          })}

          {/* x-axis ordinal labels */}
          {points.map((p, i) =>
            i % labelEvery === 0 || i === points.length - 1 ? (
              <text
                key={`l-${i}`}
                x={xOf(i)}
                y={CHART_PLOT_H - 8}
                textAnchor="middle"
                fontFamily="var(--face-mono)"
                fontSize={10}
                fill="var(--ink-3)"
              >
                #{p.ordinal}
              </text>
            ) : null,
          )}
        </svg>

        {hover ? (
          <div
            className="frontier-chart-tooltip"
            style={{ left: hover.left, top: hover.top }}
          >
            #{hover.point.ordinal} · {formatMetricValue(hover.point.value)}
            {hover.point.isHighWater ? <span className="delta up">★ best</span> : null}
            {hover.point.promoted ? <span className="delta up">✓ promoted</span> : null}
            {hover.point.sourceCount > 0 ? (
              <span className="source-badge source-badge-tooltip">
                sources {hover.point.sourceCount}
              </span>
            ) : null}
            {selectedMetricOptions.length > 0 ? (
              <div className="frontier-chart-tooltip-metrics">
                {selectedMetricOptions.map((metric, index) => {
                  const value = hover.point.metrics[metric.name];
                  return typeof value === "number" && Number.isFinite(value) ? (
                    <div key={metric.name}>
                      <span style={{ color: extraMetricColor(index) }}>{metric.name}</span>
                      <strong>{formatMetricValue(value)}</strong>
                    </div>
                  ) : null;
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {overlaySeries.length > 0 ? (
        <div className="frontier-chart-legend" aria-label="selected metric overlays">
          {overlaySeries.map((series) => (
            <span key={series.name} className="frontier-chart-legend-item">
              <span
                className="frontier-chart-legend-line"
                style={{ background: series.color }}
              />
              {series.name}
            </span>
          ))}
        </div>
      ) : null}

      {/* floating chart controls */}
      <div className="frontier-chart-controls">
        <div className="frontier-metric-picker">
          <button
            type="button"
            className={`lineage-ctrl metric-picker-toggle${metricMenuOpen ? " active" : ""}`}
            onClick={() => setMetricMenuOpen((open) => !open)}
            title="Select extra metrics"
            aria-expanded={metricMenuOpen}
            aria-controls="frontier-extra-metrics"
            disabled={extraMetricOptions.length === 0}
          >
            <ListChecks size={14} />
            <span>{selectedExtraMetrics.length || "metrics"}</span>
          </button>
          {metricMenuOpen && extraMetricOptions.length > 0 ? (
            <div
              id="frontier-extra-metrics"
              className="frontier-metric-menu"
              role="menu"
              aria-label="Extra metrics"
            >
              {extraMetricOptions.map((metric) => {
                const checked = selectedMetricSet.has(metric.name);
                return (
                  <label key={metric.name} className="frontier-metric-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleExtraMetric(metric.name)}
                    />
                    <span className="frontier-metric-option-name">{metric.name}</span>
                    <span className="frontier-metric-option-meta">
                      {metric.direction} · {metric.measured}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>
        <button type="button" className="lineage-ctrl" onClick={zoomIn} title="Zoom in (fewer points across)">
          <Plus size={14} />
        </button>
        <button type="button" className="lineage-ctrl" onClick={zoomOut} title="Zoom out (more points across)">
          <Minus size={14} />
        </button>
        <button type="button" className="lineage-ctrl" onClick={zoomReset} title="Reset density">
          <ScanSearch size={14} />
        </button>
        <button
          type="button"
          className={`lineage-ctrl scale-toggle${useLog ? " active" : ""}`}
          onClick={() => setLogScale((v) => !v)}
          title={canLog ? (useLog ? "Switch to linear" : "Switch to log scale") : "Log unavailable (non-positive values)"}
          disabled={!canLog}
        >
          {useLog ? "log" : "lin"}
        </button>
      </div>
    </div>
  );
}

function extraMetricColor(index: number): string {
  return [
    "var(--moss)",
    "var(--oxblood)",
    "var(--sepia)",
    "#3d6f83",
    "#7b5ba7",
  ][index % 5];
}
