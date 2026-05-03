export type FrontierPoint = {
  ordinal: number;
  metrics: Record<string, number>;
  promoted: boolean;
};

export type FocusEra = {
  metric: string;
  startOrdinal: number;
};

export type MetricSeriesOption = {
  name: string;
  direction: "maximize" | "minimize";
  measured: number;
  color: string;
};

export function metricFocusedForSegment(
  metric: string,
  startOrdinal: number,
  endOrdinal: number,
  focusEras: FocusEra[],
) {
  const midpoint = (startOrdinal + endOrdinal) / 2;
  return metricFocusedAtOrdinal(metric, midpoint, focusEras);
}

export function metricFocusedAtOrdinal(
  metric: string,
  ordinal: number,
  focusEras: FocusEra[],
) {
  const active = [...focusEras]
    .sort((a, b) => a.startOrdinal - b.startOrdinal)
    .filter((era) => era.startOrdinal <= ordinal)
    .at(-1);
  return !active || active.metric === metric;
}

export function buildMetricSeries(
  metric: MetricSeriesOption,
  points: FrontierPoint[],
  fallbackDirection: "maximize" | "minimize",
  focusEras: FocusEra[],
  xOf: (index: number) => number,
  yOf: (metricName: string, value: number) => number,
) {
  const direction = metric.direction ?? fallbackDirection;
  const rawSegments: Array<{ path: string }> = [];
  const bestSegments: Array<{ path: string; startOrdinal: number; endOrdinal: number }> = [];
  let previousRaw: { index: number; point: FrontierPoint; value: number } | undefined;
  let previousBest: { index: number; point: FrontierPoint; value: number } | undefined;
  let baseline: number | undefined;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const value = point.metrics[metric.name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      previousRaw = undefined;
      previousBest = undefined;
      continue;
    }
    if (previousRaw) {
      rawSegments.push({
        path: `M ${xOf(previousRaw.index)} ${yOf(metric.name, previousRaw.value)} L ${xOf(index)} ${yOf(metric.name, value)}`,
      });
    }
    const nextBaseline =
      baseline === undefined || point.promoted
        ? value
        : baseline;
    if (previousBest) {
      bestSegments.push({
        path: `M ${xOf(previousBest.index)} ${yOf(metric.name, previousBest.value)} L ${xOf(index)} ${yOf(metric.name, nextBaseline)}`,
        startOrdinal: previousBest.point.ordinal,
        endOrdinal: point.ordinal,
      });
    }
    baseline = nextBaseline;
    previousRaw = { index, point, value };
    previousBest = { index, point, value: baseline };
  }
  return { ...metric, rawSegments, bestSegments };
}
