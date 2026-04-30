import {
  Activity,
  BarChart3,
  Bot,
  ClipboardList,
  GitBranch,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Terminal,
  TestTube2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { classNames, formatDate, formatMetric } from "../utils/format";

type SessionTab = "orchestration" | "queue" | "results" | "patches" | "events";

export function ResearchControlPlane() {
  const sessions = useQuery(api.orchestration.listResearchSessions) as
    | Array<any>
    | undefined;
  const seedDemo = useMutation(api.orchestration.seedControlPlaneDemo);
  const pauseSession = useMutation(api.orchestration.pauseSession);
  const resumeSession = useMutation(api.orchestration.resumeSession);
  const stopSession = useMutation(api.orchestration.stopSession);
  const rollbackSession = useMutation(api.orchestration.rollbackSession);
  const requestMoreExperiments = useMutation(
    api.orchestration.requestMoreExperiments,
  );
  const setSessionConcurrency = useMutation(
    api.orchestration.setSessionConcurrency,
  );
  const setWorkerControl = useMutation(api.orchestration.setWorkerControl);
  const workerControl = useQuery(api.orchestration.getWorkerControl) as
    | any
    | undefined;
  const [selectedId, setSelectedId] = useState<string>();
  const [activeTab, setActiveTab] = useState<SessionTab>("orchestration");

  useEffect(() => {
    setSelectedId((current) => current ?? sessions?.[0]?._id);
  }, [sessions]);

  const detail = useQuery(
    api.orchestration.getSessionDetail,
    selectedId ? { sessionId: selectedId as any } : "skip",
  ) as any | undefined | null;

  const selectedSession =
    detail?.session ?? sessions?.find((session) => session._id === selectedId);

  return (
    <section className="grid min-w-0 gap-4 rounded-lg border border-ink-800/70 bg-ink-900/40 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-800/80 ring-1 ring-ink-700/50">
            <Activity className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-[13px] font-semibold text-ink-50">
              Autoresearch Control Plane
            </h2>
            <p className="text-[11px] text-ink-500">
              Convex-backed queue, runs, agent output, and metrics.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void seedDemo()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-700/80 bg-ink-800/60 px-3 text-[12px] font-medium text-ink-100 transition hover:border-ink-600 hover:bg-ink-800"
        >
          <TestTube2 className="h-3.5 w-3.5" aria-hidden="true" />
          Seed session
        </button>
      </header>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          {sessions === undefined ? (
            <p className="rounded-md border border-ink-800 bg-ink-950/30 p-3 text-[12px] text-ink-500">
              Loading sessions.
            </p>
          ) : sessions.length === 0 ? (
            <p className="rounded-md border border-ink-800 bg-ink-950/30 p-3 text-[12px] text-ink-500">
              No control-plane sessions yet.
            </p>
          ) : (
            sessions.map((session) => (
              <button
                key={session._id}
                type="button"
                onClick={() => setSelectedId(session._id)}
                className={classNames(
                  "min-w-0 overflow-hidden rounded-md border px-3 py-2 text-left transition",
                  session._id === selectedId
                    ? "border-emerald-500/40 bg-emerald-500/[0.06]"
                    : "border-ink-800 bg-ink-950/30 hover:border-ink-700",
                )}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <p
                    className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-100"
                    title={session.title}
                  >
                    {session.title}
                  </p>
                  <StatusPill status={session.status} />
                </div>
                <p className="mt-1 truncate font-mono text-[10px] text-ink-500">
                  {session.slug}
                </p>
                <p className="mt-2 truncate font-mono text-[10px] text-ink-500">
                  {session.completedExperimentCount}/
                  {session.targetExperimentCount} done ·{" "}
                  {session.activeRunCount} active
                </p>
              </button>
            ))
          )}
        </div>

        {selectedSession ? (
          <div className="grid min-w-0 gap-4">
            <SessionToolbar
              session={selectedSession}
              experiments={detail?.experiments ?? []}
              workerControl={workerControl}
              onPause={() =>
                void pauseSession({ sessionId: selectedSession._id })
              }
              onResume={() =>
                void resumeSession({ sessionId: selectedSession._id })
              }
              onStop={() =>
                void stopSession({
                  sessionId: selectedSession._id,
                  reason: "manual_stop",
                })
              }
              onRollback={(targetExperimentId) =>
                void rollbackSession(
                  targetExperimentId
                    ? {
                        sessionId: selectedSession._id,
                        targetExperimentId: targetExperimentId as any,
                        reason: "manual_rollback",
                      }
                    : {
                        sessionId: selectedSession._id,
                        reason: "manual_rollback",
                      },
                )
              }
              onRunMore={(count) =>
                void requestMoreExperiments({
                  sessionId: selectedSession._id,
                  count,
                })
              }
              onSetWorkers={(desiredRunnerCount) => {
                void setWorkerControl({ desiredRunnerCount });
                if (desiredRunnerCount > 0) {
                  void setSessionConcurrency({
                    sessionId: selectedSession._id,
                    maxConcurrentRuns: desiredRunnerCount,
                  });
                }
              }}
            />
            <SessionTabs
              active={activeTab}
              onChange={setActiveTab}
              detail={detail}
            />
            <SessionTabPanel
              activeTab={activeTab}
              detail={detail}
              session={selectedSession}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SessionTabs({
  active,
  onChange,
  detail,
}: {
  active: SessionTab;
  onChange: (tab: SessionTab) => void;
  detail: any;
}) {
  const tabs: Array<{
    key: SessionTab;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }> = [
    {
      key: "orchestration",
      label: "Orchestration",
      icon: <Activity className="h-3.5 w-3.5" />,
    },
    {
      key: "queue",
      label: "Experiment Queue",
      icon: <ClipboardList className="h-3.5 w-3.5" />,
      count: detail?.experiments?.length ?? 0,
    },
    {
      key: "results",
      label: "Analytics & Results",
      icon: <BarChart3 className="h-3.5 w-3.5" />,
      count: completedExperiments(detail?.experiments ?? []).length,
    },
    {
      key: "patches",
      label: "Patches",
      icon: <GitBranch className="h-3.5 w-3.5" />,
      count: detail?.patches?.length ?? 0,
    },
    {
      key: "events",
      label: "Output & Events",
      icon: <Terminal className="h-3.5 w-3.5" />,
      count: (detail?.messages?.length ?? 0) + (detail?.events?.length ?? 0),
    },
  ];

  return (
    <div className="overflow-x-auto rounded-md border border-ink-800 bg-ink-950/30 p-1">
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={classNames(
              "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition",
              active === tab.key
                ? "bg-ink-800 text-ink-50 ring-1 ring-ink-700"
                : "text-ink-400 hover:bg-ink-900 hover:text-ink-100",
            )}
          >
            {tab.icon}
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className="rounded bg-ink-900 px-1.5 font-mono text-[10px] text-ink-400">
                {tab.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function SessionTabPanel({
  activeTab,
  detail,
  session,
}: {
  activeTab: SessionTab;
  detail: any;
  session: any;
}) {
  if (activeTab === "orchestration") {
    return (
      <div className="grid min-w-0 gap-4">
        <ActiveRun detail={detail} />
        <PlanningCycles cycles={detail?.planningCycles ?? []} />
      </div>
    );
  }
  if (activeTab === "queue") {
    return <ExperimentQueue experiments={detail?.experiments ?? []} />;
  }
  if (activeTab === "results") {
    return (
      <AnalyticsResults
        session={session}
        experiments={detail?.experiments ?? []}
        runs={detail?.runs ?? []}
      />
    );
  }
  if (activeTab === "patches") {
    return <PatchLedger patches={detail?.patches ?? []} />;
  }
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <LogStream logs={detail?.activeLogs ?? []} />
      <AgentMessages
        messages={detail?.messages ?? []}
        events={detail?.events ?? []}
      />
    </div>
  );
}

function SessionToolbar({
  session,
  experiments,
  workerControl,
  onPause,
  onResume,
  onStop,
  onRollback,
  onRunMore,
  onSetWorkers,
}: {
  session: any;
  experiments: any[];
  workerControl: any | undefined;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRollback: (targetExperimentId: string | undefined) => void;
  onRunMore: (count: number) => void;
  onSetWorkers: (desiredRunnerCount: number) => void;
}) {
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isRollbackModalOpen, setIsRollbackModalOpen] = useState(false);
  const [requestCount, setRequestCount] = useState("5");
  const [rollbackTargetId, setRollbackTargetId] = useState("root");
  const [runnerWorkers, setRunnerWorkers] = useState(
    workerControl?.desiredRunnerCount ?? 1,
  );
  const rollbackTargets = useMemo(
    () =>
      completedExperiments(experiments)
        .filter((experiment) => experiment.status !== "rolled_back")
        .sort((a, b) => a.ordinal - b.ordinal),
    [experiments],
  );
  const bestMetric = useMemo(() => {
    const metrics = session.bestMetrics ?? {};
    const primary = session.metricContract?.primaryMetric;
    if (!primary || typeof metrics[primary] !== "number") return "—";
    return `${primary} ${formatMetric(metrics[primary])}`;
  }, [session]);

  useEffect(() => {
    setRunnerWorkers(workerControl?.desiredRunnerCount ?? 1);
  }, [workerControl?.desiredRunnerCount]);

  function setRunnerCount(nextCount: number) {
    const desiredRunnerCount = clampInteger(nextCount, 0, 64);
    setRunnerWorkers(desiredRunnerCount);
    onSetWorkers(desiredRunnerCount);
  }

  function submitExperimentRequest() {
    onRunMore(readCount(requestCount, 5));
    setIsRequestModalOpen(false);
  }

  function submitRollback() {
    onRollback(rollbackTargetId === "root" ? undefined : rollbackTargetId);
    setIsRollbackModalOpen(false);
  }

  return (
    <div className="grid gap-3 rounded-md border border-ink-800 bg-ink-950/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3
              className="min-w-0 max-w-full truncate text-sm font-semibold text-ink-50"
              title={session.title}
            >
              {session.title}
            </h3>
            <StatusPill status={session.status} />
          </div>
          <p
            className="mt-1 truncate font-mono text-[10px] text-ink-500"
            title={session.repoPath}
          >
            {session.repoPath}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Metric label="Best" value={bestMetric} />
          <Metric label="Active" value={String(session.activeRunCount)} />
          <Metric label="Resume" value={String(session.resumeCount)} />
          <Metric label="Rollback" value={String(session.rollbackCount ?? 0)} />
          {session.status === "paused" ||
          session.status === "stopped" ||
          session.status === "completed" ? (
            <IconButton
              label="Resume"
              onClick={onResume}
              icon={<Play className="h-3.5 w-3.5" />}
            />
          ) : (
            <IconButton
              label="Pause"
              onClick={onPause}
              icon={<Pause className="h-3.5 w-3.5" />}
            />
          )}
          <IconButton
            label="Rollback"
            onClick={() => setIsRollbackModalOpen(true)}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
          />
          <IconButton
            label="Stop"
            onClick={onStop}
            icon={<Square className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(13rem,0.8fr)_minmax(12rem,0.7fr)]">
        <div className="flex items-center justify-between gap-3 rounded-md border border-ink-800 bg-ink-900/50 p-2">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wider text-ink-500">
              Experiments
            </p>
            <p className="mt-1 text-[12px] text-ink-300">
              Target {session.targetExperimentCount} ·{" "}
              {session.completedExperimentCount} done
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsRequestModalOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 text-[11px] font-medium text-emerald-100 transition hover:bg-emerald-500/15"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Request experiments
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-ink-800 bg-ink-900/50 p-2">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wider text-ink-500">
              Runners
            </p>
            <p className="mt-1 text-[12px] text-ink-300">
              Local worker processes
            </p>
          </div>
          <div className="flex h-8 items-center rounded-md border border-ink-700 bg-ink-950/80">
            <StepperButton
              label="Decrease runners"
              onClick={() => setRunnerCount(runnerWorkers - 1)}
              disabled={runnerWorkers <= 0}
              icon={<Minus className="h-3.5 w-3.5" />}
            />
            <span className="flex h-full w-12 items-center justify-center border-x border-ink-700 font-mono text-[13px] text-ink-100">
              {runnerWorkers}
            </span>
            <StepperButton
              label="Increase runners"
              onClick={() => setRunnerCount(runnerWorkers + 1)}
              disabled={runnerWorkers >= 64}
              icon={<Plus className="h-3.5 w-3.5" />}
            />
          </div>
        </div>
      </div>

      {isRequestModalOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="presentation"
          onMouseDown={() => setIsRequestModalOpen(false)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-experiments-title"
            className="w-full max-w-sm rounded-lg border border-ink-700 bg-ink-950 p-4 shadow-2xl shadow-black/40"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              submitExperimentRequest();
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <h4
                id="request-experiments-title"
                className="text-[13px] font-semibold text-ink-50"
              >
                Request experiments
              </h4>
              <button
                type="button"
                title="Close"
                onClick={() => setIsRequestModalOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ink-700/80 bg-ink-800/60 text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-4">
              <NumberField
                label="Number of experiments"
                value={requestCount}
                min={1}
                max={1000}
                onChange={setRequestCount}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsRequestModalOpen(false)}
                className="inline-flex h-8 items-center rounded-md border border-ink-700/80 bg-ink-800/60 px-3 text-[11px] font-medium text-ink-200 transition hover:border-ink-600 hover:bg-ink-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-[11px] font-medium text-emerald-100 transition hover:bg-emerald-500/15"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Request
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isRollbackModalOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="presentation"
          onMouseDown={() => setIsRollbackModalOpen(false)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="rollback-session-title"
            className="w-full max-w-md rounded-lg border border-ink-700 bg-ink-950 p-4 shadow-2xl shadow-black/40"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              submitRollback();
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <h4
                id="rollback-session-title"
                className="text-[13px] font-semibold text-ink-50"
              >
                Rollback session
              </h4>
              <button
                type="button"
                title="Close"
                onClick={() => setIsRollbackModalOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ink-700/80 bg-ink-800/60 text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <label className="mt-4 grid gap-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-ink-500">
                Rollback target
              </span>
              <select
                value={rollbackTargetId}
                onChange={(event) => setRollbackTargetId(event.target.value)}
                className="h-9 min-w-0 rounded-md border border-ink-700 bg-ink-950/80 px-2 font-mono text-[12px] text-ink-100 outline-none transition focus:border-emerald-500/60"
              >
                <option value="root">Session root</option>
                {rollbackTargets.map((experiment) => (
                  <option key={experiment._id} value={experiment._id}>
                    #{experiment.ordinal} {experiment.hypothesis}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 text-[11px] leading-5 text-ink-400">
              Later experiments, runs, and patches stay in the ledger as rolled
              back. New runs continue from the selected accepted patch when one
              exists.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsRollbackModalOpen(false)}
                className="inline-flex h-8 items-center rounded-md border border-ink-700/80 bg-ink-800/60 px-3 text-[11px] font-medium text-ink-200 transition hover:border-ink-600 hover:bg-ink-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 text-[11px] font-medium text-amber-100 transition hover:bg-amber-500/15"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Rollback
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ActiveRun({ detail }: { detail: any }) {
  const run = detail?.activeRun;
  if (!run) {
    return (
      <div className="rounded-md border border-ink-800 bg-ink-950/30 p-3 text-[12px] text-ink-500">
        No active run.
      </div>
    );
  }
  const experiment = detail.experiments?.find(
    (item: any) => item._id === run.experimentId,
  );
  return (
    <div className="rounded-md border border-sky-500/30 bg-sky-500/[0.04] p-3">
      <div className="flex items-center gap-2 text-sky-100">
        <Terminal className="h-4 w-4" aria-hidden="true" />
        <p className="text-[12px] font-semibold">Active run #{run.runNumber}</p>
        <StatusPill status={run.status} />
      </div>
      <p className="mt-2 text-[12px] text-ink-200">
        {experiment?.hypothesis ?? "Experiment claimed."}
      </p>
      <p className="mt-1 truncate font-mono text-[10px] text-ink-500">
        {run.workspacePath ?? run.workerId}
      </p>
    </div>
  );
}

function PlanningCycles({ cycles }: { cycles: any[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-ink-800 bg-ink-950/30">
      <div className="border-b border-ink-800 px-3 py-2">
        <h3 className="text-[12px] font-semibold text-ink-100">
          Planning Cycles
        </h3>
      </div>
      {cycles.length === 0 ? (
        <p className="p-3 text-[12px] text-ink-500">No planning cycles yet.</p>
      ) : (
        <div className="max-h-64 overflow-auto">
          {cycles.map((cycle) => (
            <details
              key={cycle._id}
              className="border-b border-ink-800/60 p-3 last:border-0"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusPill status={cycle.status} />
                    <span className="font-mono text-[11px] text-ink-300">
                      requested {cycle.requestedCount}
                      {typeof cycle.approvedCount === "number"
                        ? ` · approved ${cycle.approvedCount}`
                        : ""}
                    </span>
                  </div>
                  <span className="text-[11px] text-ink-500">
                    {formatDate(cycle.startedAtUtc)}
                  </span>
                </div>
              </summary>
              <div className="mt-3 grid gap-2">
                {cycle.error ? (
                  <p className="text-[11px] text-rose-300">{cycle.error}</p>
                ) : null}
                {cycle.plannerOutput ? (
                  <pre className="max-h-40 overflow-auto rounded-md bg-black/40 p-2 font-mono text-[10px] leading-4 text-ink-300">
                    {cycle.plannerOutput}
                  </pre>
                ) : null}
                {cycle.reviewerOutput ? (
                  <pre className="max-h-40 overflow-auto rounded-md bg-black/40 p-2 font-mono text-[10px] leading-4 text-ink-300">
                    {cycle.reviewerOutput}
                  </pre>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function ExperimentQueue({ experiments }: { experiments: any[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-ink-800 bg-ink-950/30">
      <div className="border-b border-ink-800 px-3 py-2">
        <h3 className="text-[12px] font-semibold text-ink-100">
          Experiment Queue
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[12px]">
          <thead>
            <tr className="border-b border-ink-800 text-left font-mono text-[10px] uppercase tracking-wider text-ink-500">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Hypothesis</th>
              <th className="px-3 py-2">Metrics</th>
            </tr>
          </thead>
          <tbody>
            {experiments.map((experiment) => (
              <tr
                key={experiment._id}
                className="border-b border-ink-800/60 last:border-0"
              >
                <td className="px-3 py-2 font-mono text-ink-500">
                  {experiment.ordinal}
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={experiment.status} />
                </td>
                <td className="px-3 py-2 text-ink-200">
                  {experiment.hypothesis}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink-400">
                  {formatMetrics(experiment.metrics)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnalyticsResults({
  session,
  experiments,
  runs,
}: {
  session: any;
  experiments: any[];
  runs: any[];
}) {
  const completed = completedExperiments(experiments);
  const metricNames = Array.from(
    new Set(
      completed.flatMap((experiment) => Object.keys(experiment.metrics ?? {})),
    ),
  ).sort();
  const primaryMetric = String(
    session.metricContract?.primaryMetric ?? metricNames[0] ?? "score",
  );
  const bestMetrics =
    session.bestMetrics ??
    bestMetricsFromExperiments(completed, session.metricContract);
  const bestPrimary =
    typeof bestMetrics[primaryMetric] === "number"
      ? bestMetrics[primaryMetric]
      : undefined;
  const totalRuns = runs.length;
  const failedRuns = runs.filter((run) => run.status === "failed").length;

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Completed"
          value={`${completed.length}/${session.targetExperimentCount}`}
        />
        <MetricCard
          label="Promoted"
          value={String(
            completed.filter((experiment) => experiment.promoted).length,
          )}
          accent
        />
        <MetricCard
          label="Best"
          value={
            bestPrimary === undefined
              ? "—"
              : `${primaryMetric} ${formatMetric(bestPrimary)}`
          }
        />
        <MetricCard
          label="Run failures"
          value={`${failedRuns}/${totalRuns}`}
          warn={failedRuns > 0}
        />
      </div>

      <MetricSummary
        metrics={bestMetrics}
        primaryMetric={primaryMetric}
        metricContract={session.metricContract}
      />
      <ResultsTrajectory
        experiments={completed}
        primaryMetric={primaryMetric}
        metricContract={session.metricContract}
      />
      <ResultsTable
        experiments={completed}
        metricNames={metricNames}
        primaryMetric={primaryMetric}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md border border-ink-800 bg-ink-950/30 p-3">
      <p className="font-mono text-[9px] uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p
        className={classNames(
          "mt-1 truncate font-mono text-lg font-semibold tabular-nums",
          warn ? "text-rose-300" : accent ? "text-emerald-300" : "text-ink-50",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MetricSummary({
  metrics,
  primaryMetric,
  metricContract,
}: {
  metrics: Record<string, number>;
  primaryMetric: string;
  metricContract: any;
}) {
  const entries = Object.entries(metrics).sort(([a], [b]) => {
    if (a === primaryMetric) return -1;
    if (b === primaryMetric) return 1;
    return a.localeCompare(b);
  });
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-ink-800 bg-ink-950/30 p-3 text-[12px] text-ink-500">
        No completed experiment metrics yet.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-ink-800 bg-ink-950/30">
      <div className="border-b border-ink-800 px-3 py-2">
        <h3 className="text-[12px] font-semibold text-ink-100">Best Metrics</h3>
      </div>
      <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
        {entries.map(([name, value]) => {
          const direction = metricDirection(metricContract, name);
          return (
            <div
              key={name}
              className="rounded-md border border-ink-800 bg-ink-900/50 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-mono text-[10px] uppercase tracking-wider text-ink-500">
                  {name}
                </p>
                {name === primaryMetric ? (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
                    Primary
                  </span>
                ) : null}
              </div>
              <p className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-ink-50">
                {formatMetric(value)}
              </p>
              <p className="mt-0.5 text-[10px] capitalize text-ink-500">
                {direction}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultsTrajectory({
  experiments,
  primaryMetric,
  metricContract,
}: {
  experiments: any[];
  primaryMetric: string;
  metricContract: any;
}) {
  const values = experiments
    .filter(
      (experiment) => typeof experiment.metrics?.[primaryMetric] === "number",
    )
    .map((experiment) => ({
      ordinal: Number(experiment.ordinal ?? 0),
      value: Number(experiment.metrics[primaryMetric]),
      promoted: Boolean(experiment.promoted),
    }));
  const direction = metricDirection(metricContract, primaryMetric);

  if (values.length === 0) {
    return (
      <div className="rounded-md border border-ink-800 bg-ink-950/30 p-3 text-[12px] text-ink-500">
        No `{primaryMetric}` trajectory yet.
      </div>
    );
  }

  const min = Math.min(...values.map((item) => item.value));
  const max = Math.max(...values.map((item) => item.value));
  const span = max - min || Math.abs(max) || 1;
  const width = 760;
  const height = 180;
  const padX = 42;
  const padTop = 20;
  const padBottom = 30;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const xSpan = values.length === 1 ? 1 : values.length - 1;
  const points = values.map((item, index) => ({
    ...item,
    x: padX + (index / xSpan) * innerW,
    y: padTop + innerH - ((item.value - min) / span) * innerH,
  }));
  const path = `M ${points.map((point) => `${point.x},${point.y}`).join(" L ")}`;

  return (
    <div className="overflow-hidden rounded-md border border-ink-800 bg-ink-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 px-3 py-2">
        <h3 className="text-[12px] font-semibold text-ink-100">
          {primaryMetric} Trajectory
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
          {direction}
        </span>
      </div>
      <div className="overflow-x-auto p-3">
        <svg
          width={width}
          height={height}
          role="img"
          className="block min-w-[48rem]"
        >
          {[0, 0.5, 1].map((t) => {
            const y = padTop + t * innerH;
            const value = max - t * (max - min);
            return (
              <g key={t}>
                <line
                  x1={padX}
                  y1={y}
                  x2={width - padX}
                  y2={y}
                  stroke="#27272a"
                  strokeDasharray="2 5"
                />
                <text
                  x={padX - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-zinc-500 font-mono text-[10px]"
                >
                  {formatMetric(value)}
                </text>
              </g>
            );
          })}
          <path
            d={path}
            fill="none"
            stroke="#34d399"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          {points.map((point) => (
            <g key={point.ordinal}>
              <circle
                cx={point.x}
                cy={point.y}
                r={point.promoted ? 5 : 3.5}
                fill={point.promoted ? "#10b981" : "#a5b4fc"}
                stroke="#09090b"
                strokeWidth="2"
              >
                <title>{`#${point.ordinal}: ${formatMetric(point.value)}`}</title>
              </circle>
              <text
                x={point.x}
                y={height - 8}
                textAnchor="middle"
                className="fill-zinc-500 font-mono text-[9px]"
              >
                #{point.ordinal}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function ResultsTable({
  experiments,
  metricNames,
  primaryMetric,
}: {
  experiments: any[];
  metricNames: string[];
  primaryMetric: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-ink-800 bg-ink-950/30">
      <div className="border-b border-ink-800 px-3 py-2">
        <h3 className="text-[12px] font-semibold text-ink-100">
          Completed Results
        </h3>
      </div>
      {experiments.length === 0 ? (
        <p className="p-3 text-[12px] text-ink-500">
          No completed experiments yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-[12px]">
            <thead>
              <tr className="border-b border-ink-800 text-left font-mono text-[10px] uppercase tracking-wider text-ink-500">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Hypothesis</th>
                {metricNames.map((name) => (
                  <th
                    key={name}
                    className={classNames(
                      "px-3 py-2 text-right",
                      name === primaryMetric && "text-emerald-300",
                    )}
                  >
                    {name}
                  </th>
                ))}
                <th className="px-3 py-2">Promoted</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((experiment) => (
                <tr
                  key={experiment._id}
                  className="border-b border-ink-800/60 last:border-0"
                >
                  <td className="px-3 py-2 font-mono text-ink-500">
                    {experiment.ordinal}
                  </td>
                  <td className="px-3 py-2 text-ink-200">
                    {experiment.hypothesis}
                  </td>
                  {metricNames.map((name) => (
                    <td
                      key={name}
                      className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-ink-300"
                    >
                      {typeof experiment.metrics?.[name] === "number"
                        ? formatMetric(experiment.metrics[name])
                        : "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {experiment.promoted ? (
                      <span className="text-emerald-300">yes</span>
                    ) : (
                      <span className="text-ink-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PatchLedger({ patches }: { patches: any[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-ink-800 bg-ink-950/30">
      <div className="border-b border-ink-800 px-3 py-2">
        <h3 className="text-[12px] font-semibold text-ink-100">Patch Ledger</h3>
      </div>
      {patches.length === 0 ? (
        <p className="p-3 text-[12px] text-ink-500">No patches stored yet.</p>
      ) : (
        <div className="max-h-72 overflow-auto">
          {patches.map((patch) => (
            <details
              key={patch._id}
              className="border-b border-ink-800/60 p-3 last:border-0"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusPill status={patch.status} />
                      <span className="font-mono text-[11px] text-ink-300">
                        {patch.contentHash.slice(0, 12)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-ink-500">
                      {patch.changedFiles.length} files ·{" "}
                      {formatDate(patch.createdAtUtc)}
                    </p>
                  </div>
                  {patch.rejectionReason ? (
                    <span className="text-[11px] text-rose-300">
                      {patch.rejectionReason}
                    </span>
                  ) : null}
                </div>
              </summary>
              <div className="mt-3 grid gap-2">
                <p className="font-mono text-[11px] text-ink-400">
                  {patch.changedFiles.join(", ") || "No changed files"}
                </p>
                {patch.rejectedFiles.length > 0 ? (
                  <p className="font-mono text-[11px] text-rose-300">
                    Rejected: {patch.rejectedFiles.join(", ")}
                  </p>
                ) : null}
                <pre className="max-h-48 overflow-auto rounded-md bg-black/40 p-2 font-mono text-[10px] leading-4 text-ink-300">
                  {patch.diff || patch.diffStat || "No diff stored."}
                </pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function LogStream({ logs }: { logs: any[] }) {
  return (
    <div className="min-w-0 rounded-md border border-ink-800 bg-black/30">
      <div className="border-b border-ink-800 px-3 py-2">
        <h3 className="text-[12px] font-semibold text-ink-100">Live Output</h3>
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-5 text-ink-300">
        {logs.length
          ? logs.map((log) => `[${log.stream}] ${log.chunk}`).join("")
          : "No active run logs."}
      </pre>
    </div>
  );
}

function AgentMessages({
  messages,
  events,
}: {
  messages: any[];
  events: any[];
}) {
  return (
    <div className="min-w-0 rounded-md border border-ink-800 bg-ink-950/30">
      <div className="border-b border-ink-800 px-3 py-2">
        <h3 className="text-[12px] font-semibold text-ink-100">
          Agent Output & Events
        </h3>
      </div>
      <div className="max-h-80 overflow-auto p-3">
        {messages.slice(0, 8).map((message) => (
          <div
            key={message._id}
            className="mb-3 rounded-md border border-ink-800 bg-ink-900/50 p-2"
          >
            <div className="flex items-center gap-1.5 text-[10px] text-ink-500">
              <Bot className="h-3 w-3" aria-hidden="true" />
              <span>{message.source}</span>
              <span>{formatDate(message.createdAtUtc)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-ink-300">
              {message.content}
            </p>
          </div>
        ))}
        {events.slice(0, 12).map((event) => (
          <p
            key={event._id}
            className="border-t border-ink-800/60 py-1.5 text-[11px] text-ink-500"
          >
            <span className="font-mono text-ink-400">{event.type}</span> ·{" "}
            {event.message}
          </p>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "running" || status === "claimed"
      ? "border-sky-400/30 bg-sky-400/10 text-sky-200"
      : status === "completed"
        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
        : status === "failed" || status === "stopped"
          ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
          : "border-ink-700 bg-ink-800/60 text-ink-300";
  return (
    <span
      className={classNames(
        "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px]",
        tone,
      )}
    >
      {status}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-ink-700/80 bg-ink-800/60 text-ink-200 transition hover:border-ink-600 hover:bg-ink-800"
    >
      {icon}
    </button>
  );
}

function StepperButton({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-full w-8 items-center justify-center text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 disabled:cursor-not-allowed disabled:text-ink-600 disabled:hover:bg-transparent"
    >
      {icon}
    </button>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid min-w-0 flex-1 gap-1">
      <span className="font-mono text-[9px] uppercase tracking-wider text-ink-500">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-0 rounded-md border border-ink-700 bg-ink-950/80 px-2 font-mono text-[12px] text-ink-100 outline-none transition focus:border-emerald-500/60"
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[4rem] rounded-md border border-ink-800 bg-ink-900/60 px-2 py-1 text-center">
      <p className="font-mono text-[9px] uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p className="mt-0.5 truncate font-mono text-[11px] text-ink-100">
        {value}
      </p>
    </div>
  );
}

function formatMetrics(metrics: Record<string, number> | undefined) {
  if (!metrics) return "—";
  return Object.entries(metrics)
    .map(([key, value]) => `${key}=${formatMetric(value)}`)
    .join(", ");
}

function completedExperiments(experiments: any[]) {
  return experiments.filter((experiment) => {
    const status = String(experiment.status ?? "");
    return status === "completed" || status === "complete" || status === "ok";
  });
}

function metricDirection(metricContract: any, metricName: string) {
  const match = Array.isArray(metricContract?.metrics)
    ? metricContract.metrics.find((metric: any) => metric?.name === metricName)
    : undefined;
  const direction = String(match?.direction ?? "").toLowerCase();
  return direction === "maximize" ? "maximize" : "minimize";
}

function bestMetricsFromExperiments(experiments: any[], metricContract: any) {
  const best: Record<string, number> = {};
  for (const experiment of experiments) {
    for (const [name, value] of Object.entries(experiment.metrics ?? {})) {
      if (typeof value !== "number") continue;
      const direction = metricDirection(metricContract, name);
      if (
        best[name] === undefined ||
        (direction === "maximize" ? value > best[name] : value < best[name])
      ) {
        best[name] = value;
      }
    }
  }
  return best;
}

function readCount(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
