export type MetricContractLike = {
  rankingMode?: unknown;
  primaryMetric?: unknown;
  metrics?: unknown;
};

export type PromotionCandidate = {
  id: string;
  ordinal?: number;
  status: string;
  metrics?: Record<string, number>;
  score?: number;
};

export function promotionMilestoneIdsForSession(
  contract: MetricContractLike,
  candidates: PromotionCandidate[],
): Set<string> {
  const milestoneIds = new Set<string>();
  let bestScore: number | undefined;
  let bestMetrics: Record<string, number> | undefined;

  for (const candidate of [...candidates].sort(candidateSort)) {
    if (!isCompletedStatus(candidate.status) || !candidate.metrics) {
      continue;
    }
    if (!constraintsPass(contract, candidate.metrics)) {
      continue;
    }

    const score =
      typeof candidate.score === "number"
        ? candidate.score
        : scoreMetrics(contract, candidate.metrics);
    const improves =
      String(contract?.rankingMode ?? "") === "lexicographic"
        ? lexicographicMetricsImprove(contract, candidate.metrics, bestMetrics)
        : bestScore === undefined || score > bestScore;

    if (improves) {
      milestoneIds.add(candidate.id);
      bestScore = score;
      bestMetrics = candidate.metrics;
    }
  }

  return milestoneIds;
}

function candidateSort(a: PromotionCandidate, b: PromotionCandidate): number {
  const ordinalDelta = Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0);
  if (ordinalDelta !== 0) {
    return ordinalDelta;
  }
  return a.id.localeCompare(b.id);
}

function scoreMetrics(
  contract: MetricContractLike,
  metrics: Record<string, number>,
): number {
  const rankingMode = String(contract?.rankingMode ?? "single_primary");
  const metricSpecs = Array.isArray(contract?.metrics) ? contract.metrics : [];
  const primaryMetric = String(
    contract?.primaryMetric ?? metricSpecs[0]?.name ?? "objective",
  );

  if (rankingMode === "lexicographic") {
    return metricSpecs.reduce((total: number, spec: any, index: number) => {
      const value = metrics[String(spec.name)];
      if (typeof value !== "number") {
        return total;
      }
      const direction = String(spec.direction ?? "minimize");
      const signed = direction === "maximize" ? value : -value;
      return total + signed / Math.pow(1000, index);
    }, 0);
  }

  if (rankingMode === "weighted_score") {
    return metricSpecs.reduce((total: number, spec: any) => {
      const value = metrics[String(spec.name)];
      if (typeof value !== "number") {
        return total;
      }
      const direction = String(spec.direction ?? "minimize");
      const signed = direction === "maximize" ? value : -value;
      return total + signed * Number(spec.weight ?? 1);
    }, 0);
  }

  const primaryValue = metrics[primaryMetric];
  if (typeof primaryValue !== "number") {
    return Number.NEGATIVE_INFINITY;
  }
  const primarySpec = metricSpecs.find(
    (spec: any) => String(spec.name) === primaryMetric,
  );
  return String(primarySpec?.direction ?? "minimize") === "maximize"
    ? primaryValue
    : -primaryValue;
}

function lexicographicMetricsImprove(
  contract: MetricContractLike,
  candidate: Record<string, number>,
  current: Record<string, number> | undefined,
): boolean {
  if (!current) {
    return true;
  }
  const specs = Array.isArray(contract?.metrics) ? contract.metrics : [];
  for (const spec of specs) {
    const name = String(spec.name);
    const candidateValue = candidate[name];
    const currentValue = current[name];
    if (typeof candidateValue !== "number") {
      return false;
    }
    if (typeof currentValue !== "number") {
      return true;
    }
    const tolerance = Number(spec.tolerance ?? spec.tieTolerance ?? 0);
    const direction = String(spec.direction ?? "minimize");
    const delta = candidateValue - currentValue;
    if (Math.abs(delta) <= tolerance) {
      continue;
    }
    return direction === "maximize" ? delta > 0 : delta < 0;
  }
  return false;
}

function constraintsPass(
  contract: MetricContractLike,
  metrics: Record<string, number>,
): boolean {
  const specs = Array.isArray(contract?.metrics) ? contract.metrics : [];
  for (const spec of specs) {
    if (String(spec.role ?? "") !== "constraint") {
      continue;
    }
    const value = metrics[String(spec.name)];
    if (typeof value !== "number") {
      return false;
    }
    if (typeof spec.min === "number" && value < spec.min) {
      return false;
    }
    if (typeof spec.max === "number" && value > spec.max) {
      return false;
    }
  }
  return true;
}

function isCompletedStatus(status: string): boolean {
  return status === "completed" || status === "complete" || status === "ok";
}
