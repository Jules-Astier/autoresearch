import { useState } from "react";
import { ArrowDown, ArrowUp, Crosshair, RefreshCw, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
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
  const listedMetrics = Array.isArray(metricContract.metrics)
    ? metricContract.metrics
    : objectiveMetrics;
  const rankingMode = String(metricContract?.rankingMode ?? "");
  const canReorder = objectiveMetrics.length > 1;
  const topObjective = objectiveMetrics[0] ? String(objectiveMetrics[0].name) : "";
  const topDirection = topObjective ? metricDirection(metricContract, topObjective) : "minimize";
  const topBest = topObjective ? session?.bestMetrics?.[topObjective] : undefined;
  const pendingSwitch = session?.pendingMetricSwitch;
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [allowedRegression, setAllowedRegression] = useState("0");
  const [syncing, setSyncing] = useState(false);

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

  async function syncLocalFiles() {
    const inferredPath = inferSessionDirectory(session);
    const selectedPath = window.prompt("Session directory", inferredPath);
    if (!selectedPath) return;
    setSyncing(true);
    try {
      const response = await fetch("/api/local/sync-metric-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Could not sync local metric files.");
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
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
        <button
          type="button"
          className="btn icon-btn"
          disabled={syncing}
          aria-label="Sync local metric files"
          title="Sync local metric files from session.json"
          onClick={() => void syncLocalFiles()}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <ol className="metric-priority-list">
        {listedMetrics.map((metric: any) => {
          const name = String(metric.name);
          const direction = metricDirection(metricContract, name);
          const objectiveIndex = objectiveMetrics.findIndex(
            (objective: any) => String(objective.name) === name,
          );
          const isObjective = objectiveIndex >= 0;
          const role = String(metric.role ?? "objective");
          return (
            <li className="metric-priority-item" key={name}>
              <div className="metric-priority-rank">
                {isObjective ? objectiveIndex + 1 : <ShieldCheck size={13} />}
              </div>
              <div className="metric-priority-body">
                <span className="metric-priority-name">{name}</span>
                <span className="metric-priority-direction">
                  {role === "constraint" ? "guardrail" : direction}
                </span>
              </div>
              <div className="metric-priority-actions">
                {isObjective && objectiveIndex > 0 && onSwitchObjective ? (
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
                  disabled={!isObjective || !canReorder || objectiveIndex === 0}
                  aria-label={`Raise ${name} priority`}
                  title={`Raise ${name} priority`}
                  onClick={() => moveMetric(objectiveIndex, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="btn icon-btn"
                  disabled={!isObjective || !canReorder || objectiveIndex === objectiveMetrics.length - 1}
                  aria-label={`Lower ${name} priority`}
                  title={`Lower ${name} priority`}
                  onClick={() => moveMetric(objectiveIndex, 1)}
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

function inferSessionDirectory(session: any) {
  const repoPath = String(session?.repoPath ?? "").replace(/\/+$/u, "");
  const slug = String(session?.slug ?? "").trim();
  if (!repoPath || !slug) return "";
  return `${repoPath}/.autoresearch/sessions/${slug}`;
}
