import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Header } from "./Header";
import { SessionTape } from "./SessionTape";
import { Frontier } from "./Frontier";
import { HypothesisNow } from "./HypothesisNow";
import { Lineage } from "./Lineage";
import { Ledger } from "./Ledger";
import { LiveTape } from "./LiveTape";
import { AgentDialogue } from "./AgentDialogue";
import { NodeDetail } from "./NodeDetail";
import { DiffSheet } from "./DiffSheet";
import { Toolbar } from "./Toolbar";
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
  const seedDemo = useMutation(api.orchestration.seedControlPlaneDemo);

  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | undefined>();
  const [diffPatchId, setDiffPatchId] = useState<string | undefined>();

  useEffect(() => {
    if (!selectedSessionId && sessions && sessions.length > 0) {
      setSelectedSessionId(sessions[0]._id);
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
  const messages = detail?.messages ?? [];
  const activeLogs = detail?.activeLogs ?? [];
  const activeRun = detail?.activeRun ?? null;
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

  const lastUpdate = session?.updatedAtUtc ?? session?.heartbeatAtUtc;
  const isLive = Boolean(activeRun) || (session?.activeRunCount ?? 0) > 0;

  return (
    <div className="lab-ledger">
      <div className="page">
        <Header isLive={isLive} lastUpdate={lastUpdate} />

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
          <EmptyShell sessions={sessions} onSeed={() => void seedDemo()} />
        ) : (
          <div className="canvas">
            <main>
              <Frontier session={session} experiments={experiments} />
              <HypothesisNow activeRun={activeRun} experiment={activeExperiment} />

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

              <Toolbar
                session={session}
                workerControl={workerControl}
                onPause={() => void pauseSession({ sessionId: session._id })}
                onResume={() => void resumeSession({ sessionId: session._id })}
                onStop={() =>
                  void stopSession({ sessionId: session._id, reason: "manual_stop" })
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
              />
            </main>

            <aside className="rail">
              <LiveTape logs={activeLogs} activeRun={activeRun} />
              <AgentDialogue messages={messages} />
            </aside>
          </div>
        )}
      </div>

      {selectedExperiment ? (
        <NodeDetail
          experiment={selectedExperiment}
          runs={runs}
          patches={patches}
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
    </div>
  );
}

function EmptyShell({
  sessions,
  onSeed,
}: {
  sessions: any[] | undefined;
  onSeed: () => void;
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
        seed the demo to see the ledger come alive.
      </p>
      <button type="button" className="btn btn-primary" onClick={onSeed}>
        seed demo session
      </button>
    </div>
  );
}
