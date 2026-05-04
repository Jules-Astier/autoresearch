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

export type FocusExperiment = {
  _id: string;
  ordinal: number;
  metrics?: Record<string, number>;
  promoted?: boolean;
  createdAtUtc?: string;
};

export type MetricPromotion = {
  metric: string;
  ordinal: number;
};

export function buildFocusEras({
  events,
  experiments,
  fallbackMetric,
  metricContract,
}: {
  events: Array<any>;
  experiments: FocusExperiment[];
  fallbackMetric: string;
  metricContract?: any;
}): FocusEra[] {
  const firstOrdinal = experiments.length > 0 ? Math.min(...experiments.map((item) => item.ordinal)) : 0;
  const byId = new Map(experiments.map((experiment) => [String(experiment._id), experiment]));
  const switches = events
    .filter((event) => event?.type === "metric_policy.switched")
    .sort((a, b) => String(a.createdAtUtc ?? "").localeCompare(String(b.createdAtUtc ?? "")));
  const guardedMetric = guardedMetricName(metricContract);

  if (switches.length === 0) {
    if (guardedMetric && fallbackMetric && guardedMetric !== fallbackMetric) {
      const sourceOrdinal = inferGuardedSourceOrdinal(
        guardedMetric,
        metricContract,
        experiments,
      );
      if (sourceOrdinal !== undefined) {
        const nextStartOrdinal = focusStartAfter(sourceOrdinal);
        if (nextStartOrdinal === undefined) {
          return [{ metric: guardedMetric, startOrdinal: firstOrdinal }];
        }
        return [
          { metric: guardedMetric, startOrdinal: firstOrdinal },
          { metric: fallbackMetric, startOrdinal: nextStartOrdinal },
        ];
      }
    }
    return fallbackMetric ? [{ metric: fallbackMetric, startOrdinal: firstOrdinal }] : [];
  }

  const eras: FocusEra[] = [];
  const firstPayload = switches[0]?.payload ?? {};
  const firstPreviousMetric =
    metricName(firstPayload.fromObjective) ??
    metricName(firstPayload.preserveMetric) ??
    guardedMetric;
  if (firstPreviousMetric) {
    eras.push({ metric: firstPreviousMetric, startOrdinal: firstOrdinal });
  }

  for (const event of switches) {
    const payload = event?.payload ?? {};
    const toMetric = metricName(payload.toObjective) ?? metricName(metricContract?.primaryMetric);
    if (!toMetric) continue;
    const sourceExperimentId =
      metricName(payload.sourceExperimentId) ?? metricName(payload.bestExperimentId);
    const sourceOrdinal = sourceExperimentId
      ? byId.get(sourceExperimentId)?.ordinal
      : undefined;
    eras.push({
      metric: toMetric,
      startOrdinal:
        focusStartAfter(sourceOrdinal ?? inferSwitchOrdinalFromTime(event, experiments)) ??
        firstOrdinal,
    });
  }

  return eras.length > 0 ? eras : fallbackMetric ? [{ metric: fallbackMetric, startOrdinal: firstOrdinal }] : [];
}

function focusStartAfter(ordinal: number | undefined): number | undefined {
  return ordinal === undefined ? undefined : ordinal + 0.000001;
}

export function metricHasPositiveDomain(metricName: string, points: FrontierPoint[]) {
  const values = points
    .map((point) => point.metrics[metricName])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.some((value) => value > 0);
}

function inferSwitchOrdinalFromTime(
  event: any,
  experiments: FocusExperiment[],
): number | undefined {
  const switchedAt = stringValue(event?.createdAtUtc);
  if (!switchedAt) return undefined;
  return [...experiments]
    .filter((experiment) => experiment.promoted && stringValue(experiment.createdAtUtc) !== undefined)
    .filter((experiment) => String(experiment.createdAtUtc) <= switchedAt)
    .sort((a, b) => a.ordinal - b.ordinal)
    .at(-1)?.ordinal;
}

function inferGuardedSourceOrdinal(
  metric: string,
  metricContract: any,
  experiments: FocusExperiment[],
): number | undefined {
  const direction = metricDirection(metricContract, metric);
  let best: { ordinal: number; value: number } | undefined;
  for (const experiment of [...experiments].sort((a, b) => a.ordinal - b.ordinal)) {
    if (!experiment.promoted) continue;
    const value = experiment.metrics?.[metric];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (
      best === undefined ||
      (direction === "maximize" ? value > best.value : value < best.value)
    ) {
      best = { ordinal: experiment.ordinal, value };
    }
  }
  return best?.ordinal;
}

function metricDirection(metricContract: any, metric: string): "maximize" | "minimize" {
  const specs = Array.isArray(metricContract?.metrics) ? metricContract.metrics : [];
  const spec = specs.find((candidate: any) => String(candidate?.name) === metric);
  const direction = String(
    spec?.direction ??
    (String(metricContract?.primaryMetric ?? "") === metric
      ? metricContract?.direction
      : ""),
  );
  return direction === "maximize" ? "maximize" : "minimize";
}

function guardedMetricName(metricContract: any): string | undefined {
  const specs = Array.isArray(metricContract?.metrics) ? metricContract.metrics : [];
  const guardedSpec = specs.find(
    (spec: any) =>
      spec?.guardrail &&
      String(spec.guardrail.source ?? "") === "best_experiment",
  );
  return metricName(guardedSpec?.guardrail?.sourceMetric) ?? metricName(guardedSpec?.name);
}

function metricName(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text || text === "previous objective") return undefined;
  return text;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

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
    const promotedForMetric = metricPromotedAtOrdinal(
      metric.name,
      point.ordinal,
      points,
      metric.direction ?? fallbackDirection,
      focusEras,
    );
    const nextBaseline =
      baseline === undefined || promotedForMetric
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

export function metricPromotedAtOrdinal(
  metric: string,
  ordinal: number,
  points: FrontierPoint[],
  direction: "maximize" | "minimize",
  focusEras: FocusEra[],
): boolean {
  if (!metricFocusedAtOrdinal(metric, ordinal, focusEras)) {
    return false;
  }

  let best: number | undefined;
  for (const point of [...points].sort((a, b) => a.ordinal - b.ordinal)) {
    if (point.ordinal > ordinal) {
      break;
    }
    if (!metricFocusedAtOrdinal(metric, point.ordinal, focusEras)) {
      continue;
    }
    const value = point.metrics[metric];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    const improves =
      best === undefined ||
      (direction === "maximize" ? value > best : value < best);
    if (improves) {
      best = value;
    }
    if (point.ordinal === ordinal) {
      return point.promoted && improves;
    }
  }
  return false;
}
