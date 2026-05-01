import { X, RotateCcw, FileDiff, Image } from "lucide-react";
import {
  formatMetricValue,
  formatDelta,
  formatRelativeShort,
  statusGlyph,
  metricDirection,
  isImprovement,
  topObjectiveMetric,
} from "./format";

type Props = {
  experiment: any;
  runs: any[];
  patches: any[];
  artifacts: any[];
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
  artifacts,
  bestMetrics,
  metricContract,
  isRolledBack,
  onClose,
  onRollbackHere,
  onViewDiff,
}: Props) {
  if (!experiment) return null;
  const topObjective = topObjectiveMetric(metricContract);

  const experimentRuns = runs.filter((r) => r.experimentId === experiment._id);
  const experimentPatches = patches.filter((p) => p.experimentId === experiment._id);
  const experimentArtifacts = artifacts.filter((a) => a.experimentId === experiment._id);
  const status = String(experiment.status ?? "");
  const failureReason =
    status === "failed" && !isRolledBack ? String(experiment.failureReason ?? "").trim() : "";

  const metricEntries = Object.entries(experiment.metrics ?? {}).sort(
    ([a], [b]) =>
      a === topObjective ? -1 : b === topObjective ? 1 : a.localeCompare(b),
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
          {failureReason ? (
            <div className="sheet-section">
              <h4>failure</h4>
              <p className="failure-note">{failureReason}</p>
            </div>
          ) : null}

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
                      <tr key={name} className={name === topObjective ? "primary" : ""}>
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
                        {r.error ? <div className="run-error">{r.error}</div> : null}
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

          {experimentArtifacts.length > 0 ? (
            <div className="sheet-section">
              <h4>artifacts</h4>
              <div className="artifact-list">
                {experimentArtifacts.map((artifact) => (
                  <figure className="artifact-figure" key={artifact._id}>
                    <img
                      className="artifact-image"
                      src={artifactDataUrl(artifact)}
                      alt={artifact.sourcePath ?? artifact.path ?? "research artifact"}
                    />
                    <figcaption>
                      <Image size={13} /> {artifact.path}
                      <span className="mono">{formatBytes(artifact.byteLength)}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
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

function artifactDataUrl(artifact: any) {
  return `data:${artifact.mimeType ?? "image/png"};base64,${bytesToBase64(artifact.bytes)}`;
}

function bytesToBase64(bytes: ArrayBuffer | Uint8Array | number[]) {
  const view = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : ArrayBuffer.isView(bytes)
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new Uint8Array(bytes ?? []);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < view.length; index += chunkSize) {
    binary += String.fromCharCode(...view.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function formatBytes(value: unknown) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
