import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { RotateCcw, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Header } from "./Header";
import { SessionTape } from "./SessionTape";
import { Frontier } from "./Frontier";
import { HypothesisNow } from "./HypothesisNow";
import { Lineage } from "./Lineage";
import { Ledger } from "./Ledger";
import { AgentsPanel } from "./AgentsPanel";
import { NotesPanel } from "./NotesPanel";
import { NodeDetail } from "./NodeDetail";
import { DiffSheet } from "./DiffSheet";
import { Toolbar } from "./Toolbar";
import { MetricPriorityPanel } from "./MetricPriorityPanel";
import { formatMetricValue, topObjectiveMetric } from "./format";
import { NewSessionDialog, type NewSessionPayload } from "./NewSessionDialog";
import { RemoveSessionDialog } from "./RemoveSessionDialog";
import { RestartSessionDialog } from "./RestartSessionDialog";
import { buildLineage, type ExperimentLite, type RollbackLite } from "./lineageTree";
import "./lab.css";

export function LabLedger() {
  const sessions = useQuery(api.orchestration.listResearchSessions) as Array<any> | undefined;
  const workerControl = useQuery(api.orchestration.getWorkerControl) as any | undefined;

  const pauseSession = useMutation(api.orchestration.pauseSession);
  const resumeSession = useMutation(api.orchestration.resumeSession);
  const stopSession = useMutation(api.orchestration.stopSession);
  const rollbackSession = useMutation(api.orchestration.rollbackSession);
  const requestMore = useMutation(api.orchestration.requestMoreExperiments);
  const setSessionConcurrency = useMutation(api.orchestration.setSessionConcurrency);
  const setWorkerControl = useMutation(api.orchestration.setWorkerControl);
  const updateSessionContract = useMutation(api.orchestration.updateResearchSessionContract);
  const registerSession = useMutation(api.orchestration.registerResearchSession);
  const removeSession = useMutation(api.orchestration.removeResearchSession);
  const restartSession = useMutation(api.orchestration.restartResearchSession);

  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | undefined>();
  const [diffPatchId, setDiffPatchId] = useState<string | undefined>();
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [isRemoveSessionOpen, setIsRemoveSessionOpen] = useState(false);
  const [isRestartSessionOpen, setIsRestartSessionOpen] = useState(false);

  useEffect(() => {
    if (!selectedSessionId && sessions && sessions.length > 0) {
      setSelectedSessionId(sessions[0]._id);
    }
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || !sessions || sessions.length === 0) return;
    if (!sessions.some((candidate) => candidate._id === selectedSessionId)) {
      setSelectedSessionId(sessions[0]._id);
      setSelectedExperimentId(undefined);
      setDiffPatchId(undefined);
    }
  }, [sessions, selectedSessionId]);

  const detail = useQuery(
    api.orchestration.getSessionDetail,
    selectedSessionId ? { sessionId: selectedSessionId as any } : "skip",
  ) as any | undefined | null;

  const session = detail?.session ?? sessions?.find((s) => s._id === selectedSessionId);
  const experiments: ExperimentLite[] = (detail?.experiments ?? []) as ExperimentLite[];
  const rollbacks: RollbackLite[] = (detail?.rollbacks ?? []) as RollbackLite[];
  const runs = detail?.runs ?? [];
  const patches = detail?.patches ?? [];
  const artifacts = detail?.artifacts ?? [];
  const messages = detail?.messages ?? [];
  const agentUsageSummary = detail?.agentUsageSummary;
  const planningCycles = detail?.planningCycles ?? [];
  const memoryNotes = detail?.memoryNotes ?? [];
  const activeLogs = detail?.activeLogs ?? [];
  const activeRun = detail?.activeRun ?? null;
  const activePlanningCycle = planningCycles.find((cycle: any) => cycle.status === "running");
  const activeExperiment = activeRun
    ? experiments.find((e) => e._id === activeRun.experimentId)
    : undefined;

  const rolledBackIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rollbacks) for (const id of r.rolledBackExperimentIds ?? []) set.add(id);
    return set;
  }, [rollbacks]);

  const lineage = useMemo(
    () =>
      buildLineage(
        experiments,
        rollbacks,
        session?.bestExperimentId,
        activeExperiment?._id,
      ),
    [experiments, rollbacks, session?.bestExperimentId, activeExperiment?._id],
  );

  const selectedExperiment = selectedExperimentId
    ? experiments.find((e) => e._id === selectedExperimentId)
    : undefined;
  const selectedPatch = diffPatchId ? patches.find((p: any) => p._id === diffPatchId) : undefined;
  const bestExperiment = session?.bestExperimentId
    ? experiments.find((experiment) => experiment._id === session.bestExperimentId)
    : undefined;
  const topObjective = topObjectiveMetric(session?.metricContract);

  const lastUpdate = session?.updatedAtUtc ?? session?.heartbeatAtUtc;
  const isLive =
    Boolean(activeRun) ||
    Boolean(activePlanningCycle) ||
    (session?.activeRunCount ?? 0) > 0;

  return (
    <div className="lab-ledger">
      <div className="page">
        <Header
          isLive={isLive}
          lastUpdate={lastUpdate}
          onNewSession={() => setIsNewSessionOpen(true)}
        />

        <SessionTape
          sessions={sessions ?? []}
          selectedId={selectedSessionId}
          onSelect={(id) => {
            setSelectedSessionId(id);
            setSelectedExperimentId(undefined);
            setDiffPatchId(undefined);
          }}
        />

        {!session ? (
          <EmptyShell
            sessions={sessions}
            onNewSession={() => setIsNewSessionOpen(true)}
          />
        ) : (
          <div className="canvas">
            <main>
              <section className="progress-stage" aria-label="Current progress">
                <MiniStatusBar
                  session={session}
                  isLive={isLive}
                  topObjective={topObjective}
                  bestValue={topObjective ? session.bestMetrics?.[topObjective] : undefined}
                  activePlanningCycle={activePlanningCycle}
                  activeExperiment={activeExperiment}
                  workerControl={workerControl}
                  lastUpdate={lastUpdate}
                />
                <Frontier
                  session={session}
                  experiments={experiments}
                  onSelectExperiment={setSelectedExperimentId}
                />
                <HypothesisNow activeRun={activeRun} experiment={activeExperiment} />
              </section>

              <section className="session-config" aria-label="Session config">
                <Toolbar
                  session={session}
                  workerControl={workerControl}
                  activePlanningCycle={activePlanningCycle}
                  onPause={() => pauseSession({ sessionId: session._id })}
                  onResume={() => resumeSession({ sessionId: session._id })}
                  onStop={() =>
                    stopSession({ sessionId: session._id, reason: "manual_stop" })
                  }
                  onRequestExperiments={(count) =>
                    void requestMore({ sessionId: session._id, count })
                  }
                  onSetRunners={(count) => {
                    void setWorkerControl({ desiredRunnerCount: count });
                    if (count > 0) {
                      void setSessionConcurrency({
                        sessionId: session._id,
                        maxConcurrentRuns: count,
                      });
                    }
                  }}
                  onSetPlannerCount={(count) => {
                    void setWorkerControl({ desiredPlannerCount: count });
                    void setSessionConcurrency({
                      sessionId: session._id,
                      maxPlannedConcurrentExperiments: count,
                    });
                  }}
                  onSetComputeBudgetSeconds={(seconds) => {
                    void updateSessionContract({
                      sessionId: session._id,
                      computeBudget: { ...(session.computeBudget ?? {}), seconds },
                    });
                  }}
                  onSetResearcherEnabled={(enabled) => {
                    void updateSessionContract({
                      sessionId: session._id,
                      memory: {
                        ...(session.memory ?? {}),
                        enabled: true,
                        researcher: {
                          ...(session.memory?.researcher ?? {}),
                          enabled,
                        },
                      },
                    });
                  }}
                  onSetMemoryKeeperEnabled={(enabled) => {
                    void updateSessionContract({
                      sessionId: session._id,
                      memory: {
                        ...(session.memory ?? {}),
                        enabled: true,
                        memoryKeeper: {
                          ...(session.memory?.memoryKeeper ?? {}),
                          enabled,
                        },
                      },
                    });
                  }}
                />
                <MetricPriorityPanel
                  session={session}
                  bestExperimentOrdinal={bestExperiment?.ordinal}
                  onReorder={(metricContract) =>
                    updateSessionContract({
                      sessionId: session._id,
                      metricContract,
                    })
                  }
                />
              </section>

              <section className="section agents-section">
                <div className="section-head">
                  <h2 className="section-title">agents</h2>
                  <span className="section-aside">
                    {planningCycles.length} cycles · {messages.length} messages
                  </span>
                </div>
                <AgentsPanel
                  session={session}
                  planningCycles={planningCycles}
                  messages={messages}
                  agentUsageSummary={agentUsageSummary}
                  activeRun={activeRun}
                  activeLogs={activeLogs}
                  runs={runs}
                  experiments={experiments}
                  activeExperiment={activeExperiment}
                  workerControl={workerControl}
                  onSelectExperiment={setSelectedExperimentId}
                />
              </section>

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">lineage</h2>
                  <span className="section-aside">
                    {lineage.trunk.length} on trunk · {lineage.branches.length} dead branch
                    {lineage.branches.length === 1 ? "" : "es"}
                  </span>
                </div>
                <Lineage
                  lineage={lineage}
                  selectedExperimentId={selectedExperimentId}
                  onSelect={setSelectedExperimentId}
                />
              </section>

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">ledger</h2>
                  <span className="section-aside">
                    {experiments.length} entr{experiments.length === 1 ? "y" : "ies"}
                  </span>
                </div>
                <Ledger
                  experiments={experiments}
                  rolledBackIds={rolledBackIds}
                  selectedExperimentId={selectedExperimentId}
                  onSelect={setSelectedExperimentId}
                  metricContract={session.metricContract}
                  bestMetrics={session.bestMetrics}
                />
              </section>

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">notes</h2>
                  <span className="section-aside">
                    {memoryNotes.length} item{memoryNotes.length === 1 ? "" : "s"}
                  </span>
                </div>
                <NotesPanel notes={memoryNotes} memoryConfig={session.memory} />
              </section>

              <section className="section danger-zone" aria-label="Session reset">
                <div>
                  <h2 className="section-title">session reset</h2>
                  <p>
                    Restart this session from scratch or remove it from the ledger.
                  </p>
                </div>
                <div className="danger-actions">
                  <button
                    type="button"
                    className="btn btn-warn"
                    onClick={() => setIsRestartSessionOpen(true)}
                  >
                    <RotateCcw size={13} />
                    restart session
                  </button>
                  <button
                    type="button"
                    className="btn btn-warn"
                    onClick={() => setIsRemoveSessionOpen(true)}
                  >
                    <Trash2 size={13} />
                    remove session
                  </button>
                </div>
              </section>
            </main>
          </div>
        )}
      </div>

      {selectedExperiment ? (
        <NodeDetail
          experiment={selectedExperiment}
          runs={runs}
          patches={patches}
          artifacts={artifacts}
          bestMetrics={session?.bestMetrics}
          metricContract={session?.metricContract}
          isRolledBack={rolledBackIds.has(selectedExperiment._id)}
          onClose={() => setSelectedExperimentId(undefined)}
          onViewDiff={(patchId) => setDiffPatchId(patchId)}
          onRollbackHere={() => {
            if (!session) return;
            void rollbackSession({
              sessionId: session._id,
              targetExperimentId: selectedExperiment._id as any,
              reason: "manual_rollback",
            });
            setSelectedExperimentId(undefined);
          }}
        />
      ) : null}

      {selectedPatch ? (
        <DiffSheet patch={selectedPatch} onClose={() => setDiffPatchId(undefined)} />
      ) : null}

      {isNewSessionOpen ? (
        <NewSessionDialog
          onClose={() => setIsNewSessionOpen(false)}
          onCreate={async (payload: NewSessionPayload) => {
            const sessionId = await registerSession(payload as any);
            setSelectedSessionId(String(sessionId));
            setSelectedExperimentId(undefined);
            setDiffPatchId(undefined);
          }}
        />
      ) : null}

      {isRemoveSessionOpen && session ? (
        <RemoveSessionDialog
          session={session}
          onClose={() => setIsRemoveSessionOpen(false)}
          onRemove={async () => {
            const nextSession = (sessions ?? []).find((candidate) => candidate._id !== session._id);
            await removeSession({ sessionId: session._id });
            setSelectedSessionId(nextSession?._id);
            setSelectedExperimentId(undefined);
            setDiffPatchId(undefined);
          }}
        />
      ) : null}

      {isRestartSessionOpen && session ? (
        <RestartSessionDialog
          session={session}
          onClose={() => setIsRestartSessionOpen(false)}
          onRestart={async () => {
            await restartSession({ sessionId: session._id });
            setSelectedExperimentId(undefined);
            setDiffPatchId(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function MiniStatusBar({
  session,
  isLive,
  topObjective,
  bestValue,
  activePlanningCycle,
  activeExperiment,
  workerControl,
  lastUpdate,
}: {
  session: any;
  isLive: boolean;
  topObjective: string;
  bestValue: number | undefined;
  activePlanningCycle: any;
  activeExperiment?: { ordinal: number; hypothesis: string } | null;
  workerControl: any;
  lastUpdate?: string;
}) {
  return (
    <div className="mini-status-bar" aria-label="Session status">
      <span className={`mini-status-dot ${isLive ? "live" : ""}`} />
      <span className="mini-status-item strong">{session.status}</span>
      <span className="mini-status-item">
        {session.completedExperimentCount ?? 0}/{session.targetExperimentCount ?? 0} done
      </span>
      <span className="mini-status-item">{session.activeRunCount ?? 0} active</span>
      <span className="mini-status-item">
        {topObjective ? `${topObjective} ${formatMetricValue(bestValue)}` : "no objective"}
      </span>
      <span className="mini-status-item">
        {workerControl?.desiredRunnerCount ?? session.maxConcurrentRuns ?? 0} runners
      </span>
      {activePlanningCycle ? (
        <span className="mini-status-item">planning {activePlanningCycle.requestedCount}</span>
      ) : null}
      {activeExperiment ? (
        <span className="mini-status-item">working #{activeExperiment.ordinal}</span>
      ) : null}
      {lastUpdate ? (
        <span className="mini-status-item muted">
          updated {new Date(lastUpdate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      ) : null}
    </div>
  );
}

function EmptyShell({
  sessions,
  onNewSession,
}: {
  sessions: any[] | undefined;
  onNewSession: () => void;
}) {
  return (
    <div
      style={{
        padding: "48px 28px",
        textAlign: "center",
        background: "var(--paper-1)",
        borderRadius: 10,
        boxShadow: "var(--shadow-paper)",
      }}
    >
      <p style={{ fontFamily: "var(--face-cond)", fontSize: 22, marginBottom: 6 }}>
        {sessions === undefined ? "loading sessions…" : "no research sessions yet"}
      </p>
      <p style={{ color: "var(--ink-3)", fontSize: 14, marginBottom: 18 }}>
        register a session to see the ledger come alive.
      </p>
      <div className="empty-actions">
        <button type="button" className="btn btn-primary" onClick={onNewSession}>
          new session
        </button>
      </div>
    </div>
  );
}
