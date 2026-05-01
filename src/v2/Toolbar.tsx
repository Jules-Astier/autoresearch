import { useEffect, useState } from "react";
import { Play, Pause, Plus, Minus, Square } from "lucide-react";

type Props = {
  session: any;
  workerControl: any | undefined;
  activePlanningCycle?: any;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRequestExperiments: (count: number) => void;
  onSetRunners: (count: number) => void;
  onSetPlannerCount: (count: number) => void;
};

export function Toolbar({
  session,
  workerControl,
  activePlanningCycle,
  onPause,
  onResume,
  onStop,
  onRequestExperiments,
  onSetRunners,
  onSetPlannerCount,
}: Props) {
  const [requestCount, setRequestCount] = useState("5");
  const [runners, setRunners] = useState(workerControl?.desiredRunnerCount ?? 1);
  const [plannerCount, setPlannerCount] = useState(
    session?.maxPlannedConcurrentExperiments ?? workerControl?.desiredPlannerCount ?? 3,
  );

  useEffect(() => {
    setRunners(workerControl?.desiredRunnerCount ?? 1);
  }, [workerControl?.desiredRunnerCount]);

  useEffect(() => {
    setPlannerCount(
      session?.maxPlannedConcurrentExperiments ?? workerControl?.desiredPlannerCount ?? 3,
    );
  }, [session?.maxPlannedConcurrentExperiments, workerControl?.desiredPlannerCount]);

  const status = String(session?.status ?? "");
  const isPausable = status !== "paused" && status !== "stopped" && status !== "completed";
  const progressParts = [
    `${session?.completedExperimentCount ?? 0}/${session?.targetExperimentCount ?? 0} done`,
    `${session?.activeRunCount ?? 0} active`,
    activePlanningCycle
      ? `planning ${activePlanningCycle.requestedCount ?? ""}`.trim()
      : "",
    `${session?.rollbackCount ?? 0} rollbacks`,
  ].filter(Boolean);

  function commitRunners(next: number) {
    const clamped = Math.max(0, Math.min(64, Math.trunc(next)));
    setRunners(clamped);
    onSetRunners(clamped);
  }

  function commitPlannerCount(next: number) {
    const clamped = Math.max(1, Math.min(64, Math.trunc(next)));
    setPlannerCount(clamped);
    onSetPlannerCount(clamped);
  }

  return (
    <div className="toolbar" aria-label="Session controls">
      <div className="group">
        {isPausable ? (
          <button type="button" className="btn" onClick={onPause}>
            <Pause size={13} /> pause
          </button>
        ) : (
          <button type="button" className="btn" onClick={onResume}>
            <Play size={13} /> resume
          </button>
        )}
        <button type="button" className="btn btn-quiet" onClick={onStop}>
          <Square size={13} /> stop
        </button>
      </div>

      <div className="group">
        <span className="group-label">runners</span>
        <div className="stepper">
          <button
            type="button"
            onClick={() => commitRunners(runners - 1)}
            disabled={runners <= 0}
            aria-label="fewer runners"
          >
            <Minus size={13} />
          </button>
          <div className="stepper-value">{runners}</div>
          <button
            type="button"
            onClick={() => commitRunners(runners + 1)}
            disabled={runners >= 64}
            aria-label="more runners"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className="group">
        <span className="group-label">max plan</span>
        <div className="stepper">
          <button
            type="button"
            onClick={() => commitPlannerCount(plannerCount - 1)}
            disabled={plannerCount <= 1}
            aria-label="fewer planned experiments"
          >
            <Minus size={13} />
          </button>
          <div className="stepper-value">{plannerCount}</div>
          <button
            type="button"
            onClick={() => commitPlannerCount(plannerCount + 1)}
            disabled={plannerCount >= 64}
            aria-label="more planned experiments"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className="group">
        <span className="group-label">request</span>
        <input
          className="input"
          type="number"
          min={1}
          max={1000}
          value={requestCount}
          onChange={(e) => setRequestCount(e.target.value)}
          style={{ width: 64 }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => {
            const n = Number.parseInt(requestCount, 10);
            if (Number.isFinite(n) && n > 0) onRequestExperiments(n);
          }}
        >
          <Plus size={13} /> experiments
        </button>
      </div>

      <div className="toolbar-spacer" />

      <div className="group">
        <span className="group-label">progress</span>
        <span className="mono" style={{ fontSize: 13, color: "var(--ink-2)" }}>
          {progressParts.join(" · ")}
        </span>
      </div>
    </div>
  );
}
