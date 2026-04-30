import {
  formatMetricValue,
  formatDelta,
  isImprovement,
  metricDirection,
  statusGlyph,
  topObjectiveMetric,
} from "./format";

type Props = {
  experiments: any[];
  rolledBackIds: Set<string>;
  selectedExperimentId?: string;
  onSelect: (experimentId: string) => void;
  metricContract: any;
  bestMetrics?: Record<string, number>;
};

export function Ledger({
  experiments,
  rolledBackIds,
  selectedExperimentId,
  onSelect,
  metricContract,
  bestMetrics,
}: Props) {
  const topObjective = topObjectiveMetric(metricContract);
  const direction = metricDirection(metricContract, topObjective);
  const sorted = [...experiments].sort((a, b) => b.ordinal - a.ordinal); // newest first

  // running-best lookup so we can show delta vs prior top-objective best
  const byOrdinal = [...experiments]
    .sort((a, b) => a.ordinal - b.ordinal)
    .filter((e) => typeof e.metrics?.[topObjective] === "number");
  const bestUntil = new Map<number, number | undefined>();
  let runningBest: number | undefined;
  for (const e of byOrdinal) {
    bestUntil.set(e.ordinal, runningBest);
    const v = e.metrics[topObjective] as number;
    runningBest =
      runningBest === undefined
        ? v
        : direction === "maximize"
          ? Math.max(runningBest, v)
          : Math.min(runningBest, v);
  }

  if (experiments.length === 0) {
    return <p className="empty">no experiments completed yet.</p>;
  }

  return (
    <div className="ledger" role="list">
      {sorted.map((e) => {
        const isDead = rolledBackIds.has(e._id);
        const isSelected = e._id === selectedExperimentId;
        const status = String(e.status ?? "");
        const objectiveValue =
          typeof e.metrics?.[topObjective] === "number"
            ? (e.metrics[topObjective] as number)
            : undefined;
        const priorBest = bestUntil.get(e.ordinal);
        const delta =
          objectiveValue !== undefined && priorBest !== undefined
            ? objectiveValue - priorBest
            : undefined;
        const deltaShown = delta !== undefined && objectiveValue !== undefined;
        const deltaSign = direction === "minimize" && delta !== undefined ? -delta : delta ?? 0;

        return (
          <div
            key={e._id}
            role="listitem"
            className={`ledger-row ${isDead ? "dim" : ""}`}
            onClick={() => onSelect(e._id)}
            style={
              isSelected
                ? { background: "var(--paper-2)", boxShadow: "inset 3px 0 0 var(--ink-1)" }
                : undefined
            }
          >
            <div className="ord">#{e.ordinal}</div>
            <div className="body">
              <div className="hyp">{e.hypothesis || <em>(no hypothesis)</em>}</div>
              <div>
                <span className="ledger-status">
                  <span className={`status-glyph ${isDead ? "rolled_back" : status}`}>
                    {isDead ? statusGlyph("rolled_back") : statusGlyph(status)}
                  </span>
                  <span>
                    {isDead ? "rolled back" : status}
                    {e.promoted && !isDead ? " · promoted" : ""}
                  </span>
                </span>
                {topObjective && objectiveValue !== undefined ? (
                  <span className="ledger-metrics ledger-metric">
                    {topObjective} <strong>{formatMetricValue(objectiveValue)}</strong>
                    {deltaShown ? (
                      <span
                        className={`delta ${
                          isImprovement(delta!, direction) ? "up" : delta === 0 ? "" : "down"
                        }`}
                      >
                        {formatDelta(deltaSign)}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="ledger-metrics">
              {e.score !== undefined ? (
                <span>
                  score <strong>{formatMetricValue(e.score)}</strong>
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
