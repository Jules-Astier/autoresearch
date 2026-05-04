export type MetricContractLike = {
  rankingMode?: unknown;
  primaryMetric?: unknown;
  direction?: unknown;
  metrics?: unknown;
};

export type PromotionCandidate = {
  id: string;
  ordinal?: number;
  status: string;
  metrics?: Record<string, number>;
  promoted?: boolean;
  score?: number;
};

export type PromotionSwitchEvent = {
  type?: unknown;
  payload?: unknown;
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

export function promotionMilestoneIdsForDisplay(
  contract: MetricContractLike,
  candidates: PromotionCandidate[],
  events: PromotionSwitchEvent[] = [],
): Set<string> {
  if (!hasBestExperimentGuardrail(contract)) {
    return promotionMilestoneIdsForSession(contract, candidates);
  }

  const milestoneIds = new Set(
    candidates
      .filter((candidate) => candidate.promoted)
      .map((candidate) => candidate.id),
  );

  const switches = events
    .filter((event) => event?.type === "metric_policy.switched")
    .sort((a, b) =>
      String((a as any).createdAtUtc ?? "").localeCompare(
        String((b as any).createdAtUtc ?? ""),
      ),
    );

  for (const event of switches) {
    const payload = isRecord(event.payload) ? event.payload : {};
    const previousMetric =
      stringValue(payload.fromObjective) ??
      stringValue(payload.preserveMetric) ??
      guardedMetricName(contract);
    if (!previousMetric) {
      continue;
    }
    const sourceExperimentId = stringValue(payload.sourceExperimentId);
    const sourceOrdinal =
      sourceExperimentId === undefined
        ? undefined
        : candidates.find((candidate) => candidate.id === sourceExperimentId)?.ordinal;
    const previousContract = singleMetricContract(contract, previousMetric);
    for (const id of promotionMilestoneIdsForSession(
      previousContract,
      candidates.filter(
        (candidate) =>
          sourceOrdinal === undefined ||
          Number(candidate.ordinal ?? 0) <= sourceOrdinal,
      ),
    )) {
      milestoneIds.add(id);
    }
  }

  if (milestoneIds.size === 0) {
    const previousMetric = guardedMetricName(contract);
    if (previousMetric) {
      for (const id of promotionMilestoneIdsForSession(
        singleMetricContract(contract, previousMetric),
        candidates,
      )) {
        milestoneIds.add(id);
      }
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
  const metricSpecs = objectiveMetricSpecs(contract);
  const primaryMetric = topObjectiveMetric(contract);

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
  const specs = objectiveMetricSpecs(contract);
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

function objectiveMetricSpecs(contract: MetricContractLike): any[] {
  const specs = Array.isArray(contract?.metrics) ? contract.metrics : [];
  const objectives = specs.filter((spec: any) => isObjectiveMetricSpec(spec));
  if (objectives.length > 0) {
    return objectives;
  }
  const primaryMetric =
    typeof contract?.primaryMetric === "string" && contract.primaryMetric.trim()
      ? contract.primaryMetric.trim()
      : undefined;
  if (!primaryMetric) {
    return [];
  }
  return [{ name: primaryMetric, direction: "minimize" }];
}

function topObjectiveMetric(contract: MetricContractLike): string {
  const objectiveName = objectiveMetricSpecs(contract)[0]?.name;
  if (String(contract?.rankingMode ?? "") === "lexicographic") {
    return String(objectiveName ?? contract?.primaryMetric ?? "objective");
  }
  return String(
    contract?.primaryMetric ?? objectiveName ?? "objective",
  );
}

function isObjectiveMetricSpec(spec: any): boolean {
  return String(spec?.role ?? "objective") !== "constraint";
}

function hasBestExperimentGuardrail(contract: MetricContractLike): boolean {
  const specs = Array.isArray(contract?.metrics) ? contract.metrics : [];
  return specs.some(
    (spec: any) =>
      spec?.guardrail &&
      String(spec.guardrail.source ?? "") === "best_experiment",
  );
}

function guardedMetricName(contract: MetricContractLike): string | undefined {
  const specs = Array.isArray(contract?.metrics) ? contract.metrics : [];
  const guardedSpec = specs.find(
    (spec: any) =>
      spec?.guardrail &&
      String(spec.guardrail.source ?? "") === "best_experiment",
  );
  return stringValue(guardedSpec?.guardrail?.sourceMetric) ?? stringValue(guardedSpec?.name);
}

function singleMetricContract(
  contract: MetricContractLike,
  metricName: string,
): MetricContractLike {
  const specs = Array.isArray(contract?.metrics) ? contract.metrics : [];
  const spec = specs.find((candidate: any) => String(candidate?.name) === metricName);
  return {
    ...contract,
    rankingMode: "single_primary",
    primaryMetric: metricName,
    direction: spec?.direction,
    metrics: [
      {
        ...(spec ?? {}),
        name: metricName,
        role: "objective",
        guardrail: undefined,
        min: undefined,
        max: undefined,
      },
    ],
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
