import { useMemo, useState } from "react";
import { formatRelativeShort, formatElapsed, statusGlyph } from "./format";

type PlanningCycle = {
  _id: string;
  status: string;
  requestedCount: number;
  approvedCount?: number;
  plannerWorkerId: string;
  prompt?: string;
  researcherOutput?: string;
  plannerOutput?: string;
  reviewerOutput?: string;
  error?: string;
  startedAtUtc: string;
  completedAtUtc?: string;
};

type AgentMessage = {
  _id: string;
  role: string;
  source: string;
  content: string;
  sequence: number;
  createdAtUtc: string;
};

type ActiveRun = {
  _id: string;
  workerId: string;
  status: string;
  runNumber: number;
  startedAtUtc?: string;
  claimedAtUtc: string;
} | null;

type WorkerControl = {
  desiredRunnerCount: number;
  desiredPlannerCount: number;
  updatedAtUtc?: string;
} | null | undefined;

type UsageSummary = {
  calls: number;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type AgentUsageSummary = {
  totals: UsageSummary;
  byRole: Record<string, UsageSummary>;
  bySource: Record<string, UsageSummary>;
} | null | undefined;

type Props = {
  session: any;
  planningCycles: PlanningCycle[];
  messages: AgentMessage[];
  agentUsageSummary?: AgentUsageSummary;
  activeRun: ActiveRun;
  activeExperiment?: { ordinal: number; hypothesis: string } | null;
  workerControl: WorkerControl;
};

const AGENT_LABELS: Record<string, string> = {
  researcher: "researcher",
  planner: "planner",
  reviewer: "reviewer",
  worker: "worker",
  memory_keeper: "memory keeper",
  memoryKeeper: "memory keeper",
};

function agentLabel(source: string | undefined): string {
  if (!source) return "agent";
  return AGENT_LABELS[source] ?? source.replace(/_/g, " ");
}

function agentClass(source: string | undefined): string {
  const key = (source ?? "").toLowerCase();
  if (key.includes("planner")) return "planner";
  if (key.includes("reviewer")) return "reviewer";
  if (key.includes("research")) return "researcher";
  if (key.includes("memory")) return "memory";
  if (key.includes("worker")) return "worker";
  return "";
}

export function AgentsPanel({
  session,
  planningCycles,
  messages,
  agentUsageSummary,
  activeRun,
  activeExperiment,
  workerControl,
}: Props) {
  const activeCycle = planningCycles.find((c) => c.status === "running");
  const [expandedCycleId, setExpandedCycleId] = useState<string | undefined>(
    activeCycle?._id,
  );

  const status = useMemo(() => {
    const desiredPlanners = workerControl?.desiredPlannerCount ?? 0;
    const desiredRunners = workerControl?.desiredRunnerCount ?? 0;
    const memorySystemEnabled = session?.memory?.enabled !== false;
    const researcherEnabled =
      memorySystemEnabled && session?.memory?.researcher?.enabled !== false;
    const memoryKeeperEnabled =
      memorySystemEnabled && session?.memory?.memoryKeeper?.enabled !== false;
    const researcherActive = Boolean(
      activeCycle && researcherEnabled && !activeCycle.researcherOutput,
    );
    return [
      {
        key: "researcher",
        label: "researcher",
        active: researcherActive,
        detail: researcherEnabled
          ? activeCycle
            ? activeCycle.researcherOutput
              ? "scouted"
              : `scouting · ${formatElapsed(activeCycle.startedAtUtc)}`
            : lastMessageDetail(messages, ["researcher"])
          : "disabled",
        usage: usageDetail(agentUsageSummary, "researcher"),
      },
      {
        key: "planner",
        label: "planner",
        active: Boolean(activeCycle),
        detail: activeCycle
          ? `cycle ${activeCycle.requestedCount} req · ${activeCycle.plannerWorkerId.slice(0, 8)}`
          : `${desiredPlanners} desired`,
        usage: usageDetail(agentUsageSummary, "planner"),
      },
      {
        key: "reviewer",
        label: "reviewer",
        active: Boolean(activeCycle),
        detail: activeCycle
          ? activeCycle.reviewerOutput
            ? "reviewing"
            : "waiting on planner"
          : "idle",
        usage: usageDetail(agentUsageSummary, "reviewer"),
      },
      {
        key: "worker",
        label: "worker",
        active: Boolean(activeRun),
        detail: activeRun
          ? `#${activeExperiment?.ordinal ?? "?"} · ${activeRun.status} · ${formatElapsed(activeRun.startedAtUtc ?? activeRun.claimedAtUtc)}`
          : `${desiredRunners} desired`,
        usage: usageDetail(agentUsageSummary, "worker"),
      },
      {
        key: "memory_keeper",
        label: "memory keeper",
        active: false,
        detail: memoryKeeperEnabled
          ? lastMessageDetail(messages, ["memory_keeper", "memoryKeeper"])
          : "disabled",
        usage: usageDetail(agentUsageSummary, "memoryKeeper", "memory_keeper"),
      },
    ];
  }, [session, activeCycle, activeRun, activeExperiment, workerControl, messages, agentUsageSummary]);

  const recentMessages = useMemo(
    () => [...messages].slice(0, 30),
    [messages],
  );

  return (
    <div className="agents-panel">
      <div className="agents-roster">
        {status.map((row) => (
          <div
            key={row.key}
            className={`agent-card ${agentClass(row.key)} ${row.active ? "is-active" : ""}`}
          >
            <div className="agent-card-head">
              <span className={`agent-dot ${row.active ? "live" : ""}`} />
              <span className="agent-label">{row.label}</span>
              <span className="agent-status">
                {row.active ? "active" : "idle"}
              </span>
            </div>
            <div className="agent-detail">{row.detail}</div>
            {row.usage ? <div className="agent-usage">{row.usage}</div> : null}
          </div>
        ))}
      </div>

      {agentUsageSummary?.totals.calls ? (
        <div className="agents-usage-total">
          <span>{formatTokens(agentUsageSummary.totals.totalTokens)} tokens</span>
          <span>{agentUsageSummary.totals.calls} agent call{agentUsageSummary.totals.calls === 1 ? "" : "s"}</span>
        </div>
      ) : null}

      <div className="agents-cycles">
        <div className="section-head">
          <h3 className="section-subtitle">planning cycles</h3>
          <span className="section-aside">{planningCycles.length} recent</span>
        </div>
        {planningCycles.length === 0 ? (
          <div className="tape-empty">no planning cycles yet.</div>
        ) : (
          <ul className="cycle-list">
            {planningCycles.map((cycle) => {
              const expanded = expandedCycleId === cycle._id;
              return (
                <li
                  key={cycle._id}
                  className={`cycle-row ${cycle.status} ${expanded ? "is-open" : ""}`}
                >
                  <button
                    type="button"
                    className="cycle-summary"
                    onClick={() =>
                      setExpandedCycleId(expanded ? undefined : cycle._id)
                    }
                  >
                    <span className="cycle-glyph">
                      {statusGlyph(cycle.status)}
                    </span>
                    <span className="cycle-meta">
                      <span className="cycle-status">{cycle.status}</span>
                      <span className="cycle-when">
                        {formatRelativeShort(cycle.startedAtUtc)}
                      </span>
                    </span>
                    <span className="cycle-counts">
                      req {cycle.requestedCount}
                      {cycle.approvedCount !== undefined
                        ? ` · approved ${cycle.approvedCount}`
                        : ""}
                    </span>
                    <span className="cycle-worker">
                      {cycle.plannerWorkerId.slice(0, 10)}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="cycle-body">
                      {cycle.error ? (
                        <CycleSection title="error" body={cycle.error} tone="error" />
                      ) : null}
                      {cycle.prompt ? (
                        <CycleSection title="prompt" body={cycle.prompt} />
                      ) : null}
                      {cycle.researcherOutput ? (
                        <CycleSection
                          title="researcher"
                          body={cycle.researcherOutput}
                        />
                      ) : null}
                      {cycle.plannerOutput ? (
                        <CycleSection
                          title="planner"
                          body={cycle.plannerOutput}
                        />
                      ) : null}
                      {cycle.reviewerOutput ? (
                        <CycleSection
                          title="reviewer"
                          body={cycle.reviewerOutput}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="agents-messages">
        <div className="section-head">
          <h3 className="section-subtitle">agent messages</h3>
          <span className="section-aside">{messages.length} recent</span>
        </div>
        {recentMessages.length === 0 ? (
          <div className="tape-empty">no agent messages yet.</div>
        ) : (
          <ul className="msg-list">
            {recentMessages.map((m) => (
              <li key={m._id} className="msg-row">
                <div className="msg-head">
                  <span className={`who ${agentClass(m.source ?? m.role)}`}>
                    {agentLabel(m.source ?? m.role)}
                  </span>
                  <span className="msg-when">
                    {formatRelativeShort(m.createdAtUtc)}
                  </span>
                </div>
                <div className="msg-body">{truncate(m.content, 1200)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CycleSection({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone?: "error";
}) {
  return (
    <div className={`cycle-section ${tone ?? ""}`}>
      <div className="cycle-section-title">{title}</div>
      <pre className="cycle-section-body">{body}</pre>
    </div>
  );
}

function lastMessageDetail(messages: AgentMessage[], sources: string[]): string {
  const match = messages.find((m) =>
    sources.includes(m.source) || sources.includes(m.role),
  );
  if (!match) return "no notes recorded";
  return `last note ${formatRelativeShort(match.createdAtUtc)}`;
}

function usageDetail(summary: AgentUsageSummary, ...keys: string[]): string {
  const usage = keys
    .map((key) => summary?.byRole?.[key] ?? summary?.bySource?.[key])
    .find((item) => item && item.calls > 0);
  if (!usage) return "";
  return `${formatTokens(usage.totalTokens)} tok · ${usage.calls} call${usage.calls === 1 ? "" : "s"}`;
}

function formatTokens(value: number | undefined): string {
  const tokens = value ?? 0;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
