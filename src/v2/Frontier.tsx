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
import {
  buildMetricSeries,
  metricFocusedAtOrdinal,
  metricFocusedForSegment,
  type FocusEra,
  type MetricSeriesOption,
} from "./frontierSeries";

type Props = {
  session: any;
  experiments: ExperimentLite[];
  events?: Array<any>;
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

type MetricOption = MetricSeriesOption & {
  name: string;
  direction: "maximize" | "minimize";
  measured: number;
  color: string;
};

const DEFAULT_PX = 44;
const MIN_PX = 10;
const MAX_PX = 160;
const CHART_PLOT_H = 300;
const CHART_SCROLL_GUTTER = 16;
const CHART_H = CHART_PLOT_H + CHART_SCROLL_GUTTER;
const CHART_PAD_TOP = 24;
const CHART_PAD_BOTTOM = 34;

export function Frontier({ session, experiments, events = [], onSelectExperiment }: Props) {
  const topObjective = topObjectiveMetric(session?.metricContract);
  const direction = metricDirection(session?.metricContract, topObjective);
  const graphExperiments = useMemo(
    () => experiments.filter((experiment) => experiment.status !== "rolled_back"),
    [experiments],
  );

  const trajectory: Point[] = useMemo(() => {
    const completed = graphExperiments
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
  }, [graphExperiments, topObjective, direction]);

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
  const allMetricOptions: MetricOption[] = useMemo(() => {
    const names = new Set<string>();
    const contractMetrics = Array.isArray(session?.metricContract?.metrics)
      ? session.metricContract.metrics
      : [];
    for (const metric of contractMetrics) {
      if (metric?.name) names.add(String(metric.name));
    }
    for (const experiment of graphExperiments) {
      for (const [name, value] of Object.entries(experiment.metrics ?? {})) {
        if (typeof value === "number" && Number.isFinite(value)) names.add(name);
      }
    }
    return [...names]
      .sort((a, b) => {
        if (a === topObjective) return -1;
        if (b === topObjective) return 1;
        return a.localeCompare(b);
      })
      .map((name, index) => ({
        name,
        direction: metricDirection(session?.metricContract, name),
        measured: graphExperiments.filter(
          (experiment) =>
            typeof experiment.metrics?.[name] === "number" &&
            Number.isFinite(experiment.metrics[name]),
        ).length,
        color: metricColor(index),
      }))
      .filter((metric) => metric.measured > 0)
  }, [graphExperiments, session?.metricContract, topObjective]);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);

  useEffect(() => {
    const valid = new Set(allMetricOptions.map((metric) => metric.name));
    setSelectedMetrics((selected) => {
      const kept = selected.filter((metricName) => valid.has(metricName));
      return kept.length > 0 ? kept : allMetricOptions.map((metric) => metric.name);
    });
  }, [allMetricOptions]);

  const focusEras = useMemo(
    () => focusErasForSession({ events, experiments: graphExperiments, fallbackMetric: topObjective }),
    [events, graphExperiments, topObjective],
  );

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
          metricOptions={allMetricOptions}
          selectedMetrics={selectedMetrics}
          focusEras={focusEras}
          onToggleMetric={(metricName) => {
            setSelectedMetrics((selected) =>
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
  metricOptions,
  selectedMetrics,
  focusEras,
  onToggleMetric,
  onSelect,
}: {
  points: Point[];
  direction: "maximize" | "minimize";
  metricOptions: MetricOption[];
  selectedMetrics: string[];
  focusEras: FocusEra[];
  onToggleMetric: (metricName: string) => void;
  onSelect?: (experimentId: string) => void;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{
    point: Point;
    left: number;
    top: number;
    placement: "above" | "below";
  } | null>(null);
  const [pxPerPoint, setPxPerPoint] = useState<number>(DEFAULT_PX);
  const [logScale, setLogScale] = useState<boolean>(false);
  const [unitScale, setUnitScale] = useState<boolean>(true);
  const [metricMenuOpen, setMetricMenuOpen] = useState<boolean>(false);
  const selectedMetricSet = useMemo(
    () => new Set(selectedMetrics),
    [selectedMetrics],
  );
  const selectedMetricOptions = metricOptions.filter((metric) =>
    selectedMetricSet.has(metric.name),
  );

  // log requires all positive values; if any are <= 0 we silently fall back
  const overlayValues = selectedMetrics.flatMap((metricName) =>
    points
      .map((point) => point.metrics[metricName])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  );
  const canLog = overlayValues.length > 0 && overlayValues.every((value) => value > 0);
  const useLog = logScale && canLog;
  const tx = (v: number) => (useLog ? Math.log10(v) : v);
  const metricDomains = useMemo(() => {
    const domains = new Map<string, { min: number; max: number; span: number }>();
    for (const metric of selectedMetricOptions) {
      const values = points
        .map((point) => point.metrics[metric.name])
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        .map(tx);
      if (values.length === 0) continue;
      const metricMin = Math.min(...values);
      const metricMax = Math.max(...values);
      domains.set(metric.name, {
        min: metricMin,
        max: metricMax,
        span: metricMax - metricMin || Math.abs(metricMax) || 1,
      });
    }
    return domains;
  }, [points, selectedMetricOptions, useLog]);

  // bounds for shared-unit mode.
  const allValues = points
    .flatMap((p) => selectedMetrics.map((name) => p.metrics[name]))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map(tx);
  const min = allValues.length > 0 ? Math.min(...allValues) : 0;
  const max = allValues.length > 0 ? Math.max(...allValues) : 1;
  const span = max - min || Math.abs(max) || 1;

  const innerH = CHART_PLOT_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const yOf = (metricName: string, v: number) => {
    if (!unitScale) {
      const domain = metricDomains.get(metricName);
      if (domain) {
        return CHART_PAD_TOP + innerH - ((tx(v) - domain.min) / domain.span) * innerH;
      }
    }
    return CHART_PAD_TOP + innerH - ((tx(v) - min) / span) * innerH;
  };

  // chart width — at least viewport width, but wider if there are many points
  const minVisible = 20;
  const baseWidth = Math.max(points.length, minVisible) * pxPerPoint;

  const xOf = (i: number) => 24 + i * pxPerPoint;

  // axis ticks — 5 evenly spaced y values
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    if (!unitScale) return (1 - t) * 100;
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

  const metricSeries = selectedMetricOptions.map((metric) =>
    buildMetricSeries(metric, points, direction, focusEras, xOf, yOf),
  );
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
    const tooltipHalfWidth = Math.min(180, Math.max(80, window.innerWidth / 2 - 12));
    const minLeft = tooltipHalfWidth + 12;
    const maxLeft = Math.max(minLeft, window.innerWidth - tooltipHalfWidth - 12);
    const left = Math.min(maxLeft, Math.max(minLeft, e.clientX));
    const placement = e.clientY < 150 ? "below" : "above";
    setHover({
      point: p,
      left,
      top: placement === "below" ? e.clientY + 18 : e.clientY - 14,
      placement,
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
      <div className="frontier-chart-controls">
        <div className="frontier-metric-picker">
          <button
            type="button"
            className={`lineage-ctrl metric-picker-toggle${metricMenuOpen ? " active" : ""}`}
            onClick={() => setMetricMenuOpen((open) => !open)}
            title="Select metrics"
            aria-expanded={metricMenuOpen}
            aria-controls="frontier-extra-metrics"
            disabled={metricOptions.length === 0}
          >
            <ListChecks size={14} />
            <span>{selectedMetrics.length || "metrics"}</span>
          </button>
          {metricMenuOpen && metricOptions.length > 0 ? (
            <div
              id="frontier-extra-metrics"
              className="frontier-metric-menu"
              role="menu"
              aria-label="Metrics"
            >
              {metricOptions.map((metric) => {
                const checked = selectedMetricSet.has(metric.name);
                return (
                  <label key={metric.name} className="frontier-metric-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleMetric(metric.name)}
                    />
                    <span
                      className="frontier-metric-option-swatch"
                      style={{ background: metric.color }}
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
        <button
          type="button"
          className={`lineage-ctrl scale-toggle${!unitScale ? " active" : ""}`}
          onClick={() => setUnitScale((v) => !v)}
          title={unitScale ? "Normalize each metric to its own range" : "Use shared raw metric units"}
        >
          {unitScale ? "unit" : "norm"}
        </button>
      </div>

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
                {unitScale ? formatMetricValue(tickValue) : ""}
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

          {metricSeries.flatMap((series) =>
            series.rawSegments.map((segment, index) => (
              <path
                key={`${series.name}-raw-${index}`}
                d={segment.path}
                fill="none"
                stroke={series.color}
                strokeWidth={1.15}
                strokeOpacity={0.32}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )),
          )}

          {metricSeries.flatMap((series) =>
            series.bestSegments.map((segment, index) => {
              const focused = metricFocusedForSegment(
                series.name,
                segment.startOrdinal,
                segment.endOrdinal,
                focusEras,
              );
              return (
                <path
                  key={`${series.name}-best-${index}`}
                  d={segment.path}
                  fill="none"
                  stroke={series.color}
                  strokeWidth={focused ? 3 : 2}
                  strokeOpacity={focused ? 0.95 : 0.28}
                  strokeDasharray={focused ? undefined : "8 7"}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            }),
          )}

          {/* dots */}
          {points.map((p, i) => {
            const isHovered = hover?.point.experimentId === p.experimentId;
            return (
              <g key={p.experimentId}>
                {metricSeries.map((series) => {
                  const value = p.metrics[series.name];
                  if (typeof value !== "number" || !Number.isFinite(value)) return null;
                  const promotedForMetric =
                    p.promoted && metricFocusedAtOrdinal(series.name, p.ordinal, focusEras);
                  return (
                    <circle
                      key={series.name}
                      cx={xOf(i)}
                      cy={yOf(series.name, value)}
                      r={isHovered ? 4.3 : promotedForMetric ? 3.8 : 2.4}
                      fill={promotedForMetric ? series.color : "var(--paper-2)"}
                      stroke={series.color}
                      strokeWidth={promotedForMetric ? 2 : 1.25}
                      opacity={p.sourceCount > 0 ? 0.95 : 0.78}
                    />
                  );
                })}
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
            data-placement={hover.placement}
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
                {selectedMetricOptions.map((metric) => {
                  const value = hover.point.metrics[metric.name];
                  return typeof value === "number" && Number.isFinite(value) ? (
                    <div key={metric.name}>
                      <span style={{ color: metric.color }}>{metric.name}</span>
                      <strong>{formatMetricValue(value)}</strong>
                    </div>
                  ) : null;
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {metricSeries.length > 0 ? (
        <div className="frontier-chart-legend" aria-label="selected metric overlays">
          {metricSeries.map((series) => (
            <span key={series.name} className="frontier-chart-legend-item">
              <span
                className="frontier-chart-legend-line"
                style={{ background: series.color }}
              />
              {series.name}
            </span>
          ))}
          <span className="frontier-chart-legend-item frontier-chart-legend-note">
            darker benchmark segments mark active focus windows
          </span>
        </div>
      ) : null}
    </div>
  );
}

function metricColor(index: number): string {
  return [
    "var(--amber)",
    "#3d6f83",
    "var(--moss)",
    "var(--oxblood)",
    "#7b5ba7",
    "var(--sepia)",
  ][index % 5];
}

function focusErasForSession({
  events,
  experiments,
  fallbackMetric,
}: {
  events: Array<any>;
  experiments: ExperimentLite[];
  fallbackMetric: string;
}): FocusEra[] {
  const firstOrdinal = experiments.length > 0 ? Math.min(...experiments.map((item) => item.ordinal)) : 0;
  const byId = new Map(experiments.map((experiment) => [String(experiment._id), experiment]));
  const switches = events
    .filter((event) => event?.type === "metric_policy.switched")
    .sort((a, b) => String(a.createdAtUtc ?? "").localeCompare(String(b.createdAtUtc ?? "")));
  if (switches.length === 0) {
    return fallbackMetric ? [{ metric: fallbackMetric, startOrdinal: firstOrdinal }] : [];
  }
  const eras: FocusEra[] = [];
  const firstPayload = switches[0]?.payload ?? {};
  if (typeof firstPayload.fromObjective === "string") {
    eras.push({ metric: firstPayload.fromObjective, startOrdinal: firstOrdinal });
  }
  for (const event of switches) {
    const payload = event?.payload ?? {};
    if (typeof payload.toObjective !== "string") continue;
    const sourceOrdinal = payload.sourceExperimentId
      ? byId.get(String(payload.sourceExperimentId))?.ordinal
      : undefined;
    eras.push({
      metric: payload.toObjective,
      startOrdinal: sourceOrdinal ?? firstOrdinal,
    });
  }
  return eras.length > 0 ? eras : fallbackMetric ? [{ metric: fallbackMetric, startOrdinal: firstOrdinal }] : [];
}
