import { ArrowDown, ArrowUp, SlidersHorizontal } from "lucide-react";
import { metricDirection, objectiveMetricSpecs } from "./format";

type Props = {
  session: any;
  bestExperimentOrdinal?: number;
  onReorder: (metricContract: any) => Promise<unknown> | void;
};

export function MetricPriorityPanel({
  session,
  bestExperimentOrdinal,
  onReorder,
}: Props) {
  const metricContract = session?.metricContract ?? {};
  const objectiveMetrics = objectiveMetricSpecs(metricContract);
  const rankingMode = String(metricContract?.rankingMode ?? "");
  const canReorder = objectiveMetrics.length > 1;

  function moveMetric(index: number, delta: -1 | 1) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= objectiveMetrics.length) return;

    const reorderedObjectives = [...objectiveMetrics];
    const [item] = reorderedObjectives.splice(index, 1);
    reorderedObjectives.splice(nextIndex, 0, item);
    const objectiveNames = new Set(reorderedObjectives.map((metric: any) => String(metric.name)));
    const constraints = Array.isArray(metricContract.metrics)
      ? metricContract.metrics.filter((metric: any) => !objectiveNames.has(String(metric?.name)))
      : [];

    void onReorder({
      ...metricContract,
      primaryMetric: String(reorderedObjectives[0]?.name ?? metricContract.primaryMetric),
      direction:
        reorderedObjectives[0]?.direction ??
        metricDirection(metricContract, String(reorderedObjectives[0]?.name ?? "")),
      rankingMode: rankingMode || "lexicographic",
      metrics: [...reorderedObjectives, ...constraints],
    });
  }

  return (
    <section className="metric-priority-panel" aria-label="Metric priority">
      <div className="metric-priority-head">
        <div>
          <div className="metric-priority-title">
            <SlidersHorizontal size={14} />
            metric priority
          </div>
          <div className="metric-priority-meta">
            {rankingMode === "lexicographic" ? "lexicographic ranking" : "ranking order"}
            {bestExperimentOrdinal ? ` · current best #${bestExperimentOrdinal}` : ""}
          </div>
        </div>
      </div>

      <ol className="metric-priority-list">
        {objectiveMetrics.map((metric: any, index: number) => {
          const name = String(metric.name);
          const direction = metricDirection(metricContract, name);
          return (
            <li className="metric-priority-item" key={name}>
              <div className="metric-priority-rank">{index + 1}</div>
              <div className="metric-priority-body">
                <span className="metric-priority-name">{name}</span>
                <span className="metric-priority-direction">{direction}</span>
              </div>
              <div className="metric-priority-actions">
                <button
                  type="button"
                  className="btn icon-btn"
                  disabled={!canReorder || index === 0}
                  aria-label={`Raise ${name} priority`}
                  title={`Raise ${name} priority`}
                  onClick={() => moveMetric(index, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="btn icon-btn"
                  disabled={!canReorder || index === objectiveMetrics.length - 1}
                  aria-label={`Lower ${name} priority`}
                  title={`Lower ${name} priority`}
                  onClick={() => moveMetric(index, 1)}
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
