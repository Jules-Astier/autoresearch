import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent, WheelEvent } from "react";
import { X, RotateCcw, FileDiff, Image, Move, ZoomIn, ZoomOut } from "lucide-react";
import {
  formatMetricValue,
  formatDelta,
  formatRelativeShort,
  statusGlyph,
  metricDirection,
  isImprovement,
  topObjectiveMetric,
} from "./format";
import { experimentSourceLabel, experimentSources } from "./sources";

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
  const [selectedArtifact, setSelectedArtifact] = useState<any | null>(null);
  const [viewerTransform, setViewerTransform] = useState({ scale: 1, x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!selectedArtifact) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedArtifact(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedArtifact]);

  useEffect(() => {
    setViewerTransform({ scale: 1, x: 0, y: 0 });
    dragRef.current = null;
  }, [selectedArtifact?._id]);

  if (!experiment) return null;
  const topObjective = topObjectiveMetric(metricContract);

  const experimentRuns = runs.filter((r) => r.experimentId === experiment._id);
  const experimentPatches = patches.filter((p) => p.experimentId === experiment._id);
  const experimentArtifacts = artifacts.filter((a) => a.experimentId === experiment._id);
  const status = String(experiment.status ?? "");
  const failureReason =
    status === "failed" && !isRolledBack ? String(experiment.failureReason ?? "").trim() : "";
  const sources = experimentSources(experiment.sources);

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
          {sources.length > 0 ? (
            <div className="sheet-section">
              <h4>sources</h4>
              <div className="source-list">
                {sources.map((source, index) => {
                  const label = experimentSourceLabel(source);
                  const citation = source.citation && source.citation !== label
                    ? source.citation
                    : undefined;
                  return (
                    <div className="source-item" key={`${source.url ?? source.citation}-${index}`}>
                      {source.kind ? <span className="source-kind">{source.kind}</span> : null}
                      {source.url ? (
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {label}
                        </a>
                      ) : (
                        <span className="source-text">{source.citation ?? label}</span>
                      )}
                      {citation ? <span className="source-citation">{citation}</span> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

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
                    <button
                      type="button"
                      className="artifact-preview-button"
                      onClick={() => setSelectedArtifact(artifact)}
                      aria-label={`Open ${artifact.path ?? "research artifact"} fullscreen`}
                    >
                      <img
                        className="artifact-image"
                        src={artifactDataUrl(artifact)}
                        alt={artifact.sourcePath ?? artifact.path ?? "research artifact"}
                      />
                    </button>
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
      {selectedArtifact ? (
        <ArtifactViewer
          artifact={selectedArtifact}
          transform={viewerTransform}
          onTransformChange={setViewerTransform}
          dragRef={dragRef}
          onClose={() => setSelectedArtifact(null)}
        />
      ) : null}
    </>
  );
}

type ArtifactViewerProps = {
  artifact: any;
  transform: { scale: number; x: number; y: number };
  onTransformChange: (next: { scale: number; x: number; y: number }) => void;
  dragRef: MutableRefObject<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>;
  onClose: () => void;
};

function ArtifactViewer({
  artifact,
  transform,
  onTransformChange,
  dragRef,
  onClose,
}: ArtifactViewerProps) {
  const imageLabel = artifact.sourcePath ?? artifact.path ?? "research artifact";
  const canReset = transform.scale !== 1 || transform.x !== 0 || transform.y !== 0;

  const zoomBy = (delta: number) => {
    onTransformChange({
      ...transform,
      scale: clamp(transform.scale + delta, 0.5, 6),
    });
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextScale = clamp(transform.scale * (event.deltaY < 0 ? 1.12 : 0.88), 0.5, 6);
    onTransformChange({ ...transform, scale: nextScale });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: transform.x,
      y: transform.y,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onTransformChange({
      ...transform,
      x: drag.x + event.clientX - drag.startX,
      y: drag.y + event.clientY - drag.startY,
    });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <div className="artifact-modal" role="dialog" aria-modal="true" aria-label={imageLabel}>
      <button
        type="button"
        className="artifact-modal-backdrop"
        onClick={onClose}
        aria-label="Close artifact viewer"
      />
      <div className="artifact-modal-shell">
        <header className="artifact-modal-toolbar">
          <div className="artifact-modal-title">
            <Image size={14} />
            <span>{artifact.path ?? imageLabel}</span>
          </div>
          <div className="artifact-modal-actions">
            <button type="button" className="btn btn-quiet" onClick={() => zoomBy(-0.25)} title="Zoom out">
              <ZoomOut size={14} />
            </button>
            <span className="artifact-zoom-readout">{Math.round(transform.scale * 100)}%</span>
            <button type="button" className="btn btn-quiet" onClick={() => zoomBy(0.25)} title="Zoom in">
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => onTransformChange({ scale: 1, x: 0, y: 0 })}
              disabled={!canReset}
              title="Reset view"
            >
              <RotateCcw size={14} />
            </button>
            <button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
        </header>
        <div
          className="artifact-modal-stage"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="artifact-pan-hint">
            <Move size={13} /> drag to pan
          </div>
          <img
            className="artifact-modal-image"
            src={artifactDataUrl(artifact)}
            alt={imageLabel}
            draggable={false}
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function artifactDataUrl(artifact: any) {
  return `data:${artifact.mimeType ?? "image/png"};base64,${bytesToBase64(artifact.bytes)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
