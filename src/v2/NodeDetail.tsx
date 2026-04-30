import { X, RotateCcw, FileDiff } from "lucide-react";
import { formatMetricValue, formatDelta, formatRelativeShort, statusGlyph, metricDirection, isImprovement } from "./format";

type Props = {
  experiment: any;
  runs: any[];
  patches: any[];
  bestMetrics?: Record<string, number>;
  metricContract: any;
  isRolledBack: boolean;
  onClose: () => void;
  onRollbackHere: () => void;
  onViewDiff: (patchId: string) => void;
};

export function NodeDetail({
  experiment,
  runs,
  patches,
  bestMetrics,
  metricContract,
  isRolledBack,
  onClose,
  onRollbackHere,
  onViewDiff,
}: Props) {
  if (!experiment) return null;
  const primary = String(metricContract?.primaryMetric ?? "");
  const direction = metricDirection(metricContract, primary);

  const experimentRuns = runs.filter((r) => r.experimentId === experiment._id);
  const experimentPatches = patches.filter((p) => p.experimentId === experiment._id);
  const status = String(experiment.status ?? "");

  const metricEntries = Object.entries(experiment.metrics ?? {}).sort(
    ([a], [b]) => (a === primary ? -1 : b === primary ? 1 : a.localeCompare(b)),
  );

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="sheet" role="dialog" aria-label={`Experiment #${experiment.ordinal} detail`}>
        <header className="sheet-head">
          <div className="sheet-title-block">
            <div className="sheet-eyebrow">
              experiment #{experiment.ordinal} ·{" "}
              <span className={`status-glyph ${isRolledBack ? "rolled_back" : status}`}>
                {isRolledBack ? statusGlyph("rolled_back") : statusGlyph(status)}
              </span>{" "}
              {isRolledBack ? "rolled back" : status}
              {experiment.promoted ? " · promoted" : ""}
            </div>
            <h3 className="sheet-hyp">{experiment.hypothesis}</h3>
          </div>
          <button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>

        <div className="sheet-body">
          {metricEntries.length > 0 ? (
            <div className="sheet-section">
              <h4>metrics</h4>
              <table className="metric-table">
                <tbody>
                  {metricEntries.map(([name, raw]) => {
                    const value = raw as number;
                    const best = bestMetrics?.[name];
                    const delta =
                      best !== undefined && typeof value === "number" ? value - best : undefined;
                    const deltaSigned =
                      delta !== undefined && metricDirection(metricContract, name) === "minimize"
                        ? -delta
                        : delta;
                    return (
                      <tr key={name} className={name === primary ? "primary" : ""}>
                        <td>{name}</td>
                        <td>
                          {formatMetricValue(value)}
                          {delta !== undefined && delta !== 0 ? (
                            <span
                              className={`delta ${
                                isImprovement(delta, metricDirection(metricContract, name))
                                  ? "up"
                                  : "down"
                              }`}
                            >
                              {formatDelta(deltaSigned!)} vs best
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="sheet-section">
              <h4>metrics</h4>
              <p className="mono" style={{ fontSize: 13, color: "var(--ink-3)" }}>
                no metrics recorded.
              </p>
            </div>
          )}

          {experimentRuns.length > 0 ? (
            <div className="sheet-section">
              <h4>runs</h4>
              <table className="metric-table">
                <tbody>
                  {experimentRuns.map((r) => (
                    <tr key={r._id}>
                      <td>
                        <span className={`status-glyph ${r.status}`}>{statusGlyph(r.status)}</span>{" "}
                        run #{r.runNumber} · {r.workerId}
                      </td>
                      <td style={{ color: "var(--ink-3)" }}>
                        {r.startedAtUtc ? formatRelativeShort(r.startedAtUtc) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {experimentPatches.length > 0 ? (
            <div className="sheet-section">
              <h4>patches</h4>
              <table className="metric-table">
                <tbody>
                  {experimentPatches.map((p) => (
                    <tr key={p._id}>
                      <td>
                        <span className={`status-glyph ${p.status}`}>{statusGlyph(p.status)}</span>{" "}
                        <span className="mono">{(p.contentHash ?? "").slice(0, 10)}</span> ·{" "}
                        {(p.changedFiles ?? []).length} files
                        {p.rejectionReason ? (
                          <div style={{ color: "var(--oxblood)", fontSize: 12, marginTop: 4 }}>
                            {p.rejectionReason}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-quiet"
                          onClick={() => onViewDiff(p._id)}
                        >
                          <FileDiff size={13} /> diff
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <footer className="sheet-foot">
          <button
            type="button"
            className="btn btn-warn"
            onClick={onRollbackHere}
            disabled={isRolledBack}
            title={isRolledBack ? "already rolled back" : "rollback to this experiment as base"}
          >
            <RotateCcw size={13} /> rollback to here
          </button>
        </footer>
      </aside>
    </>
  );
}
