import { useState } from "react";
import { ArrowDown, ArrowUp, Crosshair, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { metricDirection, objectiveMetricSpecs } from "./format";

type Props = {
  session: any;
  bestExperimentOrdinal?: number;
  onReorder: (metricContract: any) => Promise<unknown> | void;
  onSwitchObjective?: (args: {
    nextObjective: string;
    preserveMetric: string;
    allowedRegression: number;
  }) => Promise<unknown> | void;
};

export function MetricPriorityPanel({
  session,
  bestExperimentOrdinal,
  onReorder,
  onSwitchObjective,
}: Props) {
  const metricContract = session?.metricContract ?? {};
  const objectiveMetrics = objectiveMetricSpecs(metricContract);
  const rankingMode = String(metricContract?.rankingMode ?? "");
  const canReorder = objectiveMetrics.length > 1;
  const topObjective = objectiveMetrics[0] ? String(objectiveMetrics[0].name) : "";
  const topDirection = topObjective ? metricDirection(metricContract, topObjective) : "minimize";
  const topBest = topObjective ? session?.bestMetrics?.[topObjective] : undefined;
  const pendingSwitch = session?.pendingMetricSwitch;
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [allowedRegression, setAllowedRegression] = useState("0");

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

  function confirmSwitch(nextObjective: string) {
    const parsed = Number(allowedRegression);
    if (!onSwitchObjective || !topObjective || !Number.isFinite(parsed) || parsed < 0) {
      return;
    }
    void onSwitchObjective({
      nextObjective,
      preserveMetric: topObjective,
      allowedRegression: parsed,
    });
    setSwitchTarget(null);
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
            {pendingSwitch ? ` · switch queued to ${pendingSwitch.toObjective}` : ""}
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
                {index > 0 && onSwitchObjective ? (
                  <button
                    type="button"
                    className="btn icon-btn"
                    disabled={typeof topBest !== "number"}
                    aria-label={`Optimize ${name} while preserving ${topObjective}`}
                    title={`Optimize ${name} while preserving ${topObjective}`}
                    onClick={() => {
                      setSwitchTarget(switchTarget === name ? null : name);
                      setAllowedRegression("0");
                    }}
                  >
                    <Crosshair size={14} />
                  </button>
                ) : null}
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
              {switchTarget === name ? (
                <div className="metric-switch-row">
                  <div className="metric-switch-copy">
                    <ShieldCheck size={13} />
                    <span>
                      preserve {topObjective} {topDirection === "maximize" ? "above" : "below"}{" "}
                      {typeof topBest === "number" ? String(topBest) : "current best"}
                    </span>
                  </div>
                  <input
                    className="metric-switch-input"
                    type="number"
                    min="0"
                    step="any"
                    value={allowedRegression}
                    aria-label={`Allowed ${topObjective} regression`}
                    title={`Allowed ${topObjective} regression`}
                    onChange={(event) => setAllowedRegression(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn metric-switch-confirm"
                    disabled={!Number.isFinite(Number(allowedRegression)) || Number(allowedRegression) < 0}
                    onClick={() => confirmSwitch(name)}
                  >
                    apply
                  </button>
                  <button
                    type="button"
                    className="btn icon-btn"
                    aria-label="Cancel objective switch"
                    title="Cancel"
                    onClick={() => setSwitchTarget(null)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
