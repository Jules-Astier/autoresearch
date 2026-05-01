import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { promotionMilestoneIdsForSession } from "./promotionHistory";

const metricMap = v.record(v.string(), v.float64());
const experimentSource = v.object({
  title: v.optional(v.string()),
  url: v.optional(v.string()),
  kind: v.optional(v.string()),
  citation: v.optional(v.string()),
});
const experimentSources = v.optional(v.array(experimentSource));
const tokenUsageArgs = {
  inputTokens: v.optional(v.float64()),
  cacheCreationInputTokens: v.optional(v.float64()),
  cacheReadInputTokens: v.optional(v.float64()),
  outputTokens: v.optional(v.float64()),
  totalTokens: v.optional(v.float64()),
};
const WORKER_CONTROL_KEY = "local";
const DEFAULT_COMPUTE_BUDGET_SECONDS = 300;
const PLANNING_CYCLE_STALE_MS = 30 * 60 * 1000;

const createSessionArgs = {
  slug: v.string(),
  title: v.string(),
  repoPath: v.string(),
  baseRef: v.optional(v.string()),
  benchmarkCommand: v.string(),
  metricParserCommand: v.optional(v.string()),
  computeBudget: v.optional(v.any()),
  targetExperimentCount: v.float64(),
  maxConcurrentRuns: v.float64(),
  maxPlannedConcurrentExperiments: v.optional(v.float64()),
  editablePaths: v.array(v.string()),
  immutablePaths: v.array(v.string()),
  runtimeConfigPaths: v.optional(v.array(v.string())),
  workspaceLinks: v.optional(v.array(v.object({
    workspacePath: v.string(),
    targetPath: v.string(),
  }))),
  modelIoContract: v.optional(v.string()),
  agent: v.optional(v.any()),
  memory: v.optional(v.any()),
  metricContract: v.any(),
  sandbox: v.optional(v.any()),
  earlyStopping: v.optional(v.any()),
};

export const listResearchSessions = query({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("researchSessions").collect();
    return sessions.sort((a, b) =>
      b.updatedAtUtc.localeCompare(a.updatedAtUtc),
    );
  },
});

export const getSessionDetail = query({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) {
      return null;
    }
    const experiments = await ctx.db
      .query("researchExperiments")
      .withIndex("by_session_ordinal", (q) => q.eq("sessionId", sessionId))
      .collect();
    const runs = await ctx.db
      .query("researchRuns")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const events = await ctx.db
      .query("researchEvents")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(80);
    const messages = await ctx.db
      .query("researchAgentMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(80);
    const agentUsage = await ctx.db
      .query("researchAgentUsage")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const patches = await ctx.db
      .query("researchPatches")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(80);
    const artifacts = await ctx.db
      .query("researchArtifacts")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(80);
    const planningCycles = await ctx.db
      .query("researchPlanningCycles")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(20);
    const rollbacks = await ctx.db
      .query("researchRollbacks")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(20);
    const memoryNotes = await ctx.db
      .query("researchMemoryNotes")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const promotionMilestoneIds = promotionMilestoneIdsForSession(
      session.metricContract,
      experiments.map((experiment) => ({
        id: String(experiment._id),
        ordinal: experiment.ordinal,
        status: experiment.status,
        metrics: experiment.metrics,
        score: experiment.score,
      })),
    );

    const activeRun =
      runs.find(
        (run) => run.status === "claimed" || run.status === "running",
      ) ?? null;
    const activeLogs = activeRun
      ? await ctx.db
          .query("researchRunLogs")
          .withIndex("by_run", (q) => q.eq("runId", activeRun._id))
          .order("desc")
          .take(120)
      : [];

    return {
      session,
      experiments: experiments.map((experiment) => ({
        ...experiment,
        failureReason: failureReasonForExperiment(experiment, runs, patches),
        promoted:
          experiment.promoted || promotionMilestoneIds.has(String(experiment._id)),
      })),
      runs,
      events,
      messages,
      agentUsage,
      agentUsageSummary: summarizeAgentUsage(agentUsage),
      patches,
      artifacts,
      planningCycles,
      rollbacks,
      memoryNotes,
      activeRun,
      activeLogs: activeLogs.reverse(),
    };
  },
});

export const getWorkerControl = query({
  args: {},
  handler: async (ctx) => {
    const control = await ctx.db
      .query("researchWorkerControls")
      .withIndex("by_key", (q) => q.eq("key", WORKER_CONTROL_KEY))
      .first();
    return {
      key: WORKER_CONTROL_KEY,
      desiredRunnerCount: control?.desiredRunnerCount ?? 0,
      desiredPlannerCount: control?.desiredPlannerCount ?? 3,
      updatedAtUtc: control?.updatedAtUtc ?? "",
    };
  },
});

export const createResearchSession = mutation({
  args: createSessionArgs,
  handler: async (ctx, args) => {
    const now = nowUtc();
    const metricContract = normalizeMetricContract(args.metricContract);
    const computeBudget = normalizeComputeBudget(args.computeBudget);
    const memory = normalizeMemoryConfig(args.memory);
    const maxPlannedConcurrentExperiments = normalizeInteger(
      args.maxPlannedConcurrentExperiments ?? 3,
      "maxPlannedConcurrentExperiments",
      1,
      64,
    );
    const sandbox = normalizeSandboxConfig(args.sandbox);
    const existing = await ctx.db
      .query("researchSessions")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (existing) {
      throw new Error(`research session already exists: ${args.slug}`);
    }

    const sessionId = await ctx.db.insert("researchSessions", {
      slug: args.slug,
      title: args.title,
      status: "running",
      repoPath: args.repoPath,
      baseRef: args.baseRef,
      benchmarkCommand: args.benchmarkCommand,
      metricParserCommand: args.metricParserCommand,
      computeBudget,
      targetExperimentCount: args.targetExperimentCount,
      maxConcurrentRuns: args.maxConcurrentRuns,
      maxPlannedConcurrentExperiments,
      completedExperimentCount: 0,
      activeRunCount: 0,
      nextExperimentOrdinal: 1,
      resumeCount: 0,
      rollbackCount: 0,
      editablePaths: args.editablePaths,
      immutablePaths: args.immutablePaths,
      runtimeConfigPaths: args.runtimeConfigPaths ?? [],
      workspaceLinks: args.workspaceLinks ?? [],
      modelIoContract: args.modelIoContract,
      agent: args.agent,
      memory,
      metricContract,
      sandbox,
      earlyStopping: args.earlyStopping,
      createdAtUtc: now,
      updatedAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId,
      type: "session.created",
      message: `Created session ${args.slug}`,
      payload: { targetExperimentCount: args.targetExperimentCount, computeBudget, maxPlannedConcurrentExperiments, sandbox },
    });
    return sessionId;
  },
});

export const registerResearchSession = mutation({
  args: createSessionArgs,
  handler: async (ctx, args) => {
    const now = nowUtc();
    const metricContract = normalizeMetricContract(args.metricContract);
    const computeBudget = normalizeComputeBudget(args.computeBudget);
    const memory = normalizeMemoryConfig(args.memory);
    const maxPlannedConcurrentExperiments = normalizeInteger(
      args.maxPlannedConcurrentExperiments ?? 3,
      "maxPlannedConcurrentExperiments",
      1,
      64,
    );
    const sandbox = normalizeSandboxConfig(args.sandbox);
    const existing = await ctx.db
      .query("researchSessions")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!existing) {
      const sessionId = await ctx.db.insert("researchSessions", {
        slug: args.slug,
        title: args.title,
        status: "running",
        repoPath: args.repoPath,
        baseRef: args.baseRef,
        benchmarkCommand: args.benchmarkCommand,
        metricParserCommand: args.metricParserCommand,
        computeBudget,
        targetExperimentCount: args.targetExperimentCount,
        maxConcurrentRuns: args.maxConcurrentRuns,
        maxPlannedConcurrentExperiments,
        completedExperimentCount: 0,
        activeRunCount: 0,
        nextExperimentOrdinal: 1,
        resumeCount: 0,
        rollbackCount: 0,
        editablePaths: args.editablePaths,
        immutablePaths: args.immutablePaths,
        runtimeConfigPaths: args.runtimeConfigPaths ?? [],
        workspaceLinks: args.workspaceLinks ?? [],
        modelIoContract: args.modelIoContract,
        agent: args.agent,
        memory,
        metricContract,
        sandbox,
        earlyStopping: args.earlyStopping,
        createdAtUtc: now,
        updatedAtUtc: now,
      });
      await insertEvent(ctx, {
        sessionId,
        type: "session.registered",
        message: `Registered session ${args.slug}`,
        payload: { targetExperimentCount: args.targetExperimentCount, computeBudget, maxPlannedConcurrentExperiments, sandbox },
      });
      return sessionId;
    }

    await ctx.db.patch(existing._id, {
      title: args.title,
      repoPath: args.repoPath,
      baseRef: args.baseRef,
      benchmarkCommand: args.benchmarkCommand,
      metricParserCommand: args.metricParserCommand,
      computeBudget,
      targetExperimentCount: args.targetExperimentCount,
      maxConcurrentRuns: args.maxConcurrentRuns,
      maxPlannedConcurrentExperiments,
      editablePaths: args.editablePaths,
      immutablePaths: args.immutablePaths,
      runtimeConfigPaths: args.runtimeConfigPaths ?? [],
      workspaceLinks: args.workspaceLinks ?? [],
      modelIoContract: args.modelIoContract,
      agent: args.agent,
      memory,
      metricContract,
      sandbox,
      earlyStopping: args.earlyStopping,
      updatedAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId: existing._id,
      type: "session.registered",
      message: `Updated registered session ${args.slug}`,
      payload: {
        repoPath: args.repoPath,
        computeBudget,
        targetExperimentCount: args.targetExperimentCount,
        maxConcurrentRuns: args.maxConcurrentRuns,
        maxPlannedConcurrentExperiments,
        sandbox,
      },
    });
    return existing._id;
  },
});

export const updateResearchSessionContract = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    benchmarkCommand: v.optional(v.string()),
    computeBudget: v.optional(v.any()),
    maxPlannedConcurrentExperiments: v.optional(v.float64()),
    editablePaths: v.optional(v.array(v.string())),
    immutablePaths: v.optional(v.array(v.string())),
    runtimeConfigPaths: v.optional(v.array(v.string())),
    workspaceLinks: v.optional(v.array(v.object({
      workspacePath: v.string(),
      targetPath: v.string(),
    }))),
    modelIoContract: v.optional(v.string()),
    agent: v.optional(v.any()),
    memory: v.optional(v.any()),
    metricContract: v.optional(v.any()),
    sandbox: v.optional(v.any()),
    earlyStopping: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await mustGetSession(ctx, args.sessionId);
    const patch: Record<string, unknown> = { updatedAtUtc: nowUtc() };
    if (args.benchmarkCommand !== undefined)
      patch.benchmarkCommand = args.benchmarkCommand;
    if (args.computeBudget !== undefined)
      patch.computeBudget = normalizeComputeBudget(args.computeBudget);
    if (args.maxPlannedConcurrentExperiments !== undefined)
      patch.maxPlannedConcurrentExperiments = normalizeInteger(
        args.maxPlannedConcurrentExperiments,
        "maxPlannedConcurrentExperiments",
        1,
        64,
      );
    if (args.editablePaths !== undefined)
      patch.editablePaths = args.editablePaths;
    if (args.immutablePaths !== undefined)
      patch.immutablePaths = args.immutablePaths;
    if (args.runtimeConfigPaths !== undefined)
      patch.runtimeConfigPaths = args.runtimeConfigPaths;
    if (args.workspaceLinks !== undefined)
      patch.workspaceLinks = args.workspaceLinks;
    if (args.modelIoContract !== undefined)
      patch.modelIoContract = args.modelIoContract;
    if (args.agent !== undefined)
      patch.agent = args.agent;
    if (args.memory !== undefined)
      patch.memory = normalizeMemoryConfig(args.memory);
    if (args.metricContract !== undefined)
      patch.metricContract = normalizeMetricContract(args.metricContract);
    if (args.sandbox !== undefined)
      patch.sandbox = normalizeSandboxConfig(args.sandbox);
    if (args.earlyStopping !== undefined)
      patch.earlyStopping = args.earlyStopping;
    await ctx.db.patch(args.sessionId, patch);
    await insertEvent(ctx, {
      sessionId: args.sessionId,
      type: "session.contract_updated",
      message: "Updated session contract.",
      payload: {
        computeBudget: args.computeBudget,
        maxPlannedConcurrentExperiments: args.maxPlannedConcurrentExperiments,
        editablePaths: args.editablePaths,
        immutablePaths: args.immutablePaths,
        runtimeConfigPaths: args.runtimeConfigPaths,
        workspaceLinks: args.workspaceLinks,
      },
    });
  },
});

export const removeResearchSession = mutation({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    await mustGetSession(ctx, sessionId);

    const runLogs = await ctx.db
      .query("researchRunLogs")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of runLogs) await ctx.db.delete(row._id);

    const agentMessages = await ctx.db
      .query("researchAgentMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of agentMessages) await ctx.db.delete(row._id);

    const agentUsage = await ctx.db
      .query("researchAgentUsage")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of agentUsage) await ctx.db.delete(row._id);

    const events = await ctx.db
      .query("researchEvents")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of events) await ctx.db.delete(row._id);

    const memoryNotes = await ctx.db
      .query("researchMemoryNotes")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of memoryNotes) await ctx.db.delete(row._id);

    const rollbacks = await ctx.db
      .query("researchRollbacks")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of rollbacks) await ctx.db.delete(row._id);

    const planningCycles = await ctx.db
      .query("researchPlanningCycles")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of planningCycles) await ctx.db.delete(row._id);

    const artifacts = await ctx.db
      .query("researchArtifacts")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of artifacts) await ctx.db.delete(row._id);

    const patches = await ctx.db
      .query("researchPatches")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of patches) await ctx.db.delete(row._id);

    const runs = await ctx.db
      .query("researchRuns")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of runs) await ctx.db.delete(row._id);

    const experiments = await ctx.db
      .query("researchExperiments")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of experiments) await ctx.db.delete(row._id);

    await ctx.db.delete(sessionId);

    return {
      deleted: {
        runLogs: runLogs.length,
        agentMessages: agentMessages.length,
        agentUsage: agentUsage.length,
        events: events.length,
        memoryNotes: memoryNotes.length,
        rollbacks: rollbacks.length,
        planningCycles: planningCycles.length,
        artifacts: artifacts.length,
        patches: patches.length,
        runs: runs.length,
        experiments: experiments.length,
      },
    };
  },
});

export const enqueueExperiment = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    hypothesis: v.string(),
    changeKind: v.string(),
    prompt: v.optional(v.string()),
    sources: experimentSources,
  },
  handler: async (ctx, args) => {
    const session = await mustGetSession(ctx, args.sessionId);
    const now = nowUtc();
    const experimentId = await ctx.db.insert("researchExperiments", {
      sessionId: args.sessionId,
      ordinal: session.nextExperimentOrdinal,
      status: "queued",
      changeKind: args.changeKind,
      hypothesis: args.hypothesis,
      prompt: args.prompt ?? "",
      sources: args.sources,
      promoted: false,
      createdAtUtc: now,
      updatedAtUtc: now,
    });
    await ctx.db.patch(args.sessionId, {
      nextExperimentOrdinal: session.nextExperimentOrdinal + 1,
      updatedAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId: args.sessionId,
      experimentId,
      type: "experiment.queued",
      message: args.hypothesis,
    });
    return experimentId;
  },
});

export const enqueueExperimentBatch = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    experiments: v.array(
      v.object({
        hypothesis: v.string(),
        changeKind: v.string(),
        prompt: v.optional(v.string()),
        sources: experimentSources,
      }),
    ),
    planningCycleId: v.optional(v.id("researchPlanningCycles")),
  },
  handler: async (ctx, args) => {
    return insertExperimentBatch(ctx, args);
  },
});

export const claimPlanningCycle = mutation({
  args: {
    sessionId: v.optional(v.id("researchSessions")),
    workerId: v.string(),
    requestedCount: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const session = args.sessionId
      ? await mustGetSession(ctx, args.sessionId)
      : await firstRunnableSession(ctx);
    if (!session) {
      return null;
    }
    if (session.status !== "running") {
      return null;
    }
    const now = nowUtc();
    const activePlanningCycles = await activePlanningCyclesForSession(
      ctx,
      session._id,
      now,
    );
    if (activePlanningCycles.length > 0) {
      return null;
    }

    const queued = await ctx.db
      .query("researchExperiments")
      .withIndex("by_session_status", (q) =>
        q.eq("sessionId", session._id).eq("status", "queued"),
      )
      .collect();
    if (queued.length > 0 || session.activeRunCount > 0) {
      return null;
    }

    const remaining = Math.max(
      0,
      session.targetExperimentCount -
        session.completedExperimentCount -
        session.activeRunCount -
        queued.length,
    );
    if (remaining <= 0) {
      return null;
    }
    const control = await ctx.db
      .query("researchWorkerControls")
      .withIndex("by_key", (q) => q.eq("key", WORKER_CONTROL_KEY))
      .first();
    const desiredPlannerCount = normalizeInteger(
      args.requestedCount ??
        session.maxPlannedConcurrentExperiments ??
        control?.desiredPlannerCount ??
        3,
      "requestedCount",
      1,
      64,
    );
    const requestedCount = Math.min(
      remaining,
      desiredPlannerCount,
    );
    const cycleId = await ctx.db.insert("researchPlanningCycles", {
      sessionId: session._id,
      status: "running",
      requestedCount,
      plannerWorkerId: args.workerId,
      startedAtUtc: now,
    });
    const experiments = await ctx.db
      .query("researchExperiments")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    const patches = await ctx.db
      .query("researchPatches")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .order("desc")
      .take(20);
    await insertEvent(ctx, {
      sessionId: session._id,
      type: "planning.started",
      message: `${args.workerId} started planning ${requestedCount} experiments.`,
      payload: { planningCycleId: cycleId, requestedCount },
    });
    return {
      planningCycleId: cycleId,
      session,
      requestedCount,
      experiments: experiments
        .filter((item) => item.status !== "rolled_back")
        .sort((a, b) => a.ordinal - b.ordinal),
      patches,
    };
  },
});

export const finishPlanningCycle = mutation({
  args: {
    planningCycleId: v.id("researchPlanningCycles"),
    researcherOutput: v.optional(v.string()),
    plannerOutput: v.string(),
    reviewerOutput: v.string(),
    approvedExperiments: v.array(
      v.object({
        hypothesis: v.string(),
        changeKind: v.string(),
        prompt: v.optional(v.string()),
        sources: experimentSources,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const cycle = await ctx.db.get(args.planningCycleId);
    if (!cycle) {
      throw new Error(`missing planning cycle ${args.planningCycleId}`);
    }
    if (cycle.status !== "running") {
      await insertEvent(ctx, {
        sessionId: cycle.sessionId,
        type: "planning.finish_ignored",
        message: `Ignored finish for ${cycle.status} planning cycle.`,
        payload: { planningCycleId: args.planningCycleId },
      });
      return [];
    }
    await ctx.db.patch(args.planningCycleId, {
      researcherOutput: args.researcherOutput?.slice(-20000),
      plannerOutput: args.plannerOutput.slice(-20000),
      reviewerOutput: args.reviewerOutput.slice(-20000),
    });
    if (args.researcherOutput) {
      await ctx.db.insert("researchAgentMessages", {
        sessionId: cycle.sessionId,
        role: "assistant",
        source: "researcher",
        content: args.researcherOutput.slice(-12000),
        sequence: Date.now() - 1,
        createdAtUtc: nowUtc(),
      });
    }
    await ctx.db.insert("researchAgentMessages", {
      sessionId: cycle.sessionId,
      role: "assistant",
      source: "planner",
      content: args.plannerOutput.slice(-12000),
      sequence: Date.now(),
      createdAtUtc: nowUtc(),
    });
    await ctx.db.insert("researchAgentMessages", {
      sessionId: cycle.sessionId,
      role: "assistant",
      source: "reviewer",
      content: args.reviewerOutput.slice(-12000),
      sequence: Date.now() + 1,
      createdAtUtc: nowUtc(),
    });
    return insertExperimentBatch(ctx, {
      sessionId: cycle.sessionId,
      experiments: args.approvedExperiments,
      planningCycleId: args.planningCycleId,
    });
  },
});

export const recordPlanningCycleResearcherOutput = mutation({
  args: {
    planningCycleId: v.id("researchPlanningCycles"),
    researcherOutput: v.string(),
  },
  handler: async (ctx, args) => {
    const cycle = await ctx.db.get(args.planningCycleId);
    if (!cycle) {
      throw new Error(`missing planning cycle ${args.planningCycleId}`);
    }
    if (cycle.status !== "running") {
      return;
    }
    await ctx.db.patch(args.planningCycleId, {
      researcherOutput: args.researcherOutput.slice(-20000),
    });
  },
});

export const failPlanningCycle = mutation({
  args: {
    planningCycleId: v.id("researchPlanningCycles"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const cycle = await ctx.db.get(args.planningCycleId);
    if (!cycle) {
      throw new Error(`missing planning cycle ${args.planningCycleId}`);
    }
    if (cycle.status !== "running") {
      return;
    }
    const now = nowUtc();
    await ctx.db.patch(args.planningCycleId, {
      status: "failed",
      error: args.error.slice(-4000),
      completedAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId: cycle.sessionId,
      type: "planning.failed",
      message: args.error.slice(0, 500),
      payload: { planningCycleId: args.planningCycleId },
    });
  },
});

export const claimNextExperiment = mutation({
  args: { workerId: v.string() },
  handler: async (ctx, { workerId }) => {
    const sessions = await ctx.db
      .query("researchSessions")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    const now = nowUtc();

    for (const session of sessions.sort((a, b) =>
      a.updatedAtUtc.localeCompare(b.updatedAtUtc),
    )) {
      if (session.activeRunCount >= session.maxConcurrentRuns) {
        continue;
      }
      if (
        session.completedExperimentCount + session.activeRunCount >=
        session.targetExperimentCount
      ) {
        continue;
      }

      let experiment = await ctx.db
        .query("researchExperiments")
        .withIndex("by_session_status", (q) =>
          q.eq("sessionId", session._id).eq("status", "queued"),
        )
        .first();

      if (!experiment) {
        continue;
      }

      const priorExperiments = await ctx.db
        .query("researchExperiments")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .collect();
      const runNumber = await nextRunNumber(ctx, experiment._id);
      const basePatch = session.basePatchId
        ? await ctx.db.get(session.basePatchId)
        : null;
      const runId = await ctx.db.insert("researchRuns", {
        sessionId: session._id,
        experimentId: experiment._id,
        workerId,
        status: "claimed",
        runNumber,
        claimedAtUtc: now,
      });

      await ctx.db.patch(experiment._id, {
        status: "claimed",
        activeRunId: runId,
        updatedAtUtc: now,
      });
      await ctx.db.patch(session._id, {
        activeRunCount: session.activeRunCount + 1,
        updatedAtUtc: now,
      });
      await insertEvent(ctx, {
        sessionId: session._id,
        experimentId: experiment._id,
        runId,
        type: "run.claimed",
        message: `${workerId} claimed experiment ${experiment.ordinal}`,
        payload: { workerId },
      });

      return {
        session,
        basePatch,
        experiment,
        runId,
        priorExperiments: priorExperiments
          .filter((item) => item._id !== experiment?._id)
          .filter((item) => item.status !== "rolled_back")
          .sort((a, b) => a.ordinal - b.ordinal),
      };
    }

    return null;
  },
});

export const startRun = mutation({
  args: {
    runId: v.id("researchRuns"),
    workspacePath: v.string(),
  },
  handler: async (ctx, { runId, workspacePath }) => {
    const run = await mustGetRun(ctx, runId);
    const now = nowUtc();
    await ctx.db.patch(runId, {
      status: "running",
      workspacePath,
      startedAtUtc: now,
    });
    await ctx.db.patch(run.experimentId, {
      status: "running",
      updatedAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId: run.sessionId,
      experimentId: run.experimentId,
      runId,
      type: "run.started",
      message: `Started run in ${workspacePath}`,
    });
  },
});

export const appendRunLog = mutation({
  args: {
    runId: v.id("researchRuns"),
    stream: v.string(),
    sequence: v.float64(),
    chunk: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await mustGetRun(ctx, args.runId);
    await ctx.db.insert("researchRunLogs", {
      sessionId: run.sessionId,
      experimentId: run.experimentId,
      runId: args.runId,
      stream: args.stream,
      sequence: args.sequence,
      chunk: args.chunk.slice(-8000),
      createdAtUtc: nowUtc(),
    });
  },
});

export const appendAgentMessage = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    experimentId: v.optional(v.id("researchExperiments")),
    runId: v.optional(v.id("researchRuns")),
    role: v.string(),
    source: v.string(),
    content: v.string(),
    sequence: v.float64(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("researchAgentMessages", {
      ...args,
      createdAtUtc: nowUtc(),
    });
  },
});

export const recordAgentUsage = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    experimentId: v.optional(v.id("researchExperiments")),
    runId: v.optional(v.id("researchRuns")),
    planningCycleId: v.optional(v.id("researchPlanningCycles")),
    role: v.string(),
    source: v.string(),
    provider: v.string(),
    model: v.optional(v.string()),
    ...tokenUsageArgs,
    rawUsage: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const totalTokens =
      args.totalTokens ??
      sumDefined([
        args.inputTokens,
        args.cacheCreationInputTokens,
        args.cacheReadInputTokens,
        args.outputTokens,
      ]);
    await ctx.db.insert("researchAgentUsage", {
      ...args,
      totalTokens,
      createdAtUtc: nowUtc(),
    });
  },
});

export const recordMemoryNotes = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    runId: v.optional(v.id("researchRuns")),
    notes: v.array(
      v.object({
        path: v.string(),
        kind: v.string(),
        content: v.optional(v.string()),
        entries: v.optional(v.array(v.string())),
        byteLength: v.optional(v.float64()),
        contentHash: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { sessionId, runId, notes }) => {
    const now = nowUtc();
    for (const note of notes) {
      const existing = await ctx.db
        .query("researchMemoryNotes")
        .withIndex("by_session_path", (q) =>
          q.eq("sessionId", sessionId).eq("path", note.path),
        )
        .first();
      const fields = {
        sessionId,
        path: note.path,
        kind: note.kind,
        content: note.content,
        entries: note.entries,
        byteLength: note.byteLength,
        contentHash: note.contentHash,
        updatedAtUtc: now,
        updatedByRunId: runId,
      };
      if (existing) {
        if (existing.contentHash && existing.contentHash === note.contentHash) {
          continue;
        }
        await ctx.db.patch(existing._id, fields);
      } else {
        await ctx.db.insert("researchMemoryNotes", fields);
      }
    }
  },
});

export const updateExperimentPlan = mutation({
  args: {
    experimentId: v.id("researchExperiments"),
    hypothesis: v.string(),
    changeKind: v.string(),
  },
  handler: async (ctx, args) => {
    const experiment = await mustGetExperiment(ctx, args.experimentId);
    await ctx.db.patch(args.experimentId, {
      hypothesis: args.hypothesis,
      changeKind: args.changeKind,
      updatedAtUtc: nowUtc(),
    });
    await insertEvent(ctx, {
      sessionId: experiment.sessionId,
      experimentId: args.experimentId,
      type: "experiment.planned",
      message: args.hypothesis,
      payload: { changeKind: args.changeKind },
    });
  },
});

export const recordPatch = mutation({
  args: {
    runId: v.id("researchRuns"),
    workspacePath: v.string(),
    changedFiles: v.array(v.string()),
    rejectedFiles: v.array(v.string()),
    editablePaths: v.array(v.string()),
    immutablePaths: v.array(v.string()),
    diff: v.string(),
    diffStat: v.string(),
    contentHash: v.string(),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await mustGetRun(ctx, args.runId);
    const session = await mustGetSession(ctx, run.sessionId);
    const now = nowUtc();
    const status =
      args.rejectedFiles.length > 0 || args.rejectionReason
        ? "rejected"
        : "accepted";
    const rejectionReason =
      args.rejectionReason ??
      (args.rejectedFiles.length > 0
        ? `Changed files outside editable paths: ${args.rejectedFiles.join(", ")}`
        : "");
    const patchId = await ctx.db.insert("researchPatches", {
      sessionId: run.sessionId,
      experimentId: run.experimentId,
      runId: args.runId,
      status,
      baseRef: session.baseRef,
      workspacePath: args.workspacePath,
      changedFiles: args.changedFiles,
      rejectedFiles: args.rejectedFiles,
      editablePaths: args.editablePaths,
      immutablePaths: args.immutablePaths,
      diff: args.diff,
      diffStat: args.diffStat,
      contentHash: args.contentHash,
      rejectionReason,
      createdAtUtc: now,
    });
    await ctx.db.patch(args.runId, { patchId });
    await insertEvent(ctx, {
      sessionId: run.sessionId,
      experimentId: run.experimentId,
      runId: args.runId,
      type: status === "accepted" ? "patch.accepted" : "patch.rejected",
      message:
        status === "accepted"
          ? `Stored patch ${args.contentHash}`
          : rejectionReason,
      payload: {
        patchId,
        changedFiles: args.changedFiles,
        rejectedFiles: args.rejectedFiles,
        diffStat: args.diffStat,
      },
    });
    return { patchId, status, rejectionReason };
  },
});

export const recordResearchArtifact = mutation({
  args: {
    runId: v.id("researchRuns"),
    kind: v.string(),
    sourcePath: v.string(),
    path: v.string(),
    mimeType: v.string(),
    byteLength: v.float64(),
    bytes: v.bytes(),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await mustGetRun(ctx, args.runId);
    const now = nowUtc();
    const artifactId = await ctx.db.insert("researchArtifacts", {
      sessionId: run.sessionId,
      experimentId: run.experimentId,
      runId: args.runId,
      kind: args.kind,
      sourcePath: args.sourcePath,
      path: args.path,
      mimeType: args.mimeType,
      byteLength: args.byteLength,
      bytes: args.bytes,
      contentHash: args.contentHash,
      createdAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId: run.sessionId,
      experimentId: run.experimentId,
      runId: args.runId,
      type: "artifact.stored",
      message: `Stored ${args.kind} artifact ${args.path}`,
      payload: {
        artifactId,
        sourcePath: args.sourcePath,
        path: args.path,
        mimeType: args.mimeType,
        byteLength: args.byteLength,
        contentHash: args.contentHash,
      },
    });
    return artifactId;
  },
});

export const completeRun = mutation({
  args: {
    runId: v.id("researchRuns"),
    patchId: v.id("researchPatches"),
    codexExitCode: v.float64(),
    benchmarkExitCode: v.float64(),
    metrics: metricMap,
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await mustGetRun(ctx, args.runId);
    if (run.status === "rolled_back") {
      return;
    }
    const patch = await ctx.db.get(args.patchId);
    if (!patch || patch.runId !== args.runId) {
      throw new Error(
        "run completion must reference a patch recorded for this run",
      );
    }
    if (patch.status !== "accepted") {
      throw new Error("run completion cannot use a rejected patch");
    }
    const session = await mustGetSession(ctx, run.sessionId);
    const now = nowUtc();
    const status = args.benchmarkExitCode === 0 ? "completed" : "failed";
    const failureReason =
      status === "failed"
        ? `benchmark exited with ${args.benchmarkExitCode}`
        : undefined;
    const score = scoreMetrics(session.metricContract, args.metrics);
    const promoted =
      status === "completed" && isNewBest(session, score, args.metrics);

    await ctx.db.patch(args.runId, {
      status,
      codexExitCode: args.codexExitCode,
      benchmarkExitCode: args.benchmarkExitCode,
      metrics: args.metrics,
      score,
      summary: args.summary,
      ...(failureReason ? { error: failureReason } : {}),
      finishedAtUtc: now,
    });
    await ctx.db.patch(run.experimentId, {
      status,
      metrics: args.metrics,
      score,
      promoted,
      updatedAtUtc: now,
    });

    const nextCompleted = session.completedExperimentCount + 1;
    const nextActive = Math.max(0, session.activeRunCount - 1);
    const earlyStopped = shouldEarlyStop(session, promoted, nextCompleted);
    const nextStatus = earlyStopped
      ? "completed"
      : nextCompleted >= session.targetExperimentCount && nextActive === 0
        ? "completed"
        : session.status;

    await ctx.db.patch(run.sessionId, {
      completedExperimentCount: nextCompleted,
      activeRunCount: nextActive,
      bestExperimentId: promoted ? run.experimentId : session.bestExperimentId,
      bestScore: promoted ? score : session.bestScore,
      bestMetrics: promoted ? args.metrics : session.bestMetrics,
      status: nextStatus,
      stoppedReason: earlyStopped ? "early_stopping" : session.stoppedReason,
      updatedAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId: run.sessionId,
      experimentId: run.experimentId,
      runId: args.runId,
      type: status === "completed" ? "run.completed" : "run.failed",
      message: promoted
        ? "Run completed and became the current best."
        : failureReason ?? `Run ${status}.`,
      payload: {
        metrics: args.metrics,
        score,
        promoted,
        ...(failureReason ? { error: failureReason } : {}),
      },
    });
    return { status, score, promoted, sessionStatus: nextStatus };
  },
});

export const failRun = mutation({
  args: {
    runId: v.id("researchRuns"),
    error: v.string(),
    codexExitCode: v.optional(v.float64()),
    benchmarkExitCode: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const run = await mustGetRun(ctx, args.runId);
    if (run.status === "rolled_back") {
      return;
    }
    const session = await mustGetSession(ctx, run.sessionId);
    const now = nowUtc();
    await ctx.db.patch(args.runId, {
      status: "failed",
      error: args.error,
      codexExitCode: args.codexExitCode,
      benchmarkExitCode: args.benchmarkExitCode,
      finishedAtUtc: now,
    });
    await ctx.db.patch(run.experimentId, {
      status: "failed",
      updatedAtUtc: now,
    });
    await ctx.db.patch(run.sessionId, {
      completedExperimentCount: session.completedExperimentCount + 1,
      activeRunCount: Math.max(0, session.activeRunCount - 1),
      updatedAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId: run.sessionId,
      experimentId: run.experimentId,
      runId: args.runId,
      type: "run.failed",
      message: args.error,
    });
  },
});

export const pauseSession = mutation({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    await patchSessionStatus(
      ctx,
      sessionId,
      "paused",
      "session.paused",
      "Paused session.",
    );
  },
});

export const stopSession = mutation({
  args: { sessionId: v.id("researchSessions"), reason: v.optional(v.string()) },
  handler: async (ctx, { sessionId, reason }) => {
    await patchSessionStatus(
      ctx,
      sessionId,
      "stopped",
      "session.stopped",
      reason ?? "Stopped session.",
      reason,
    );
  },
});

export const resumeSession = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    targetExperimentCount: v.optional(v.float64()),
  },
  handler: async (ctx, { sessionId, targetExperimentCount }) => {
    const session = await mustGetSession(ctx, sessionId);
    const now = nowUtc();
    await ctx.db.patch(sessionId, {
      status: "running",
      targetExperimentCount:
        targetExperimentCount ?? session.targetExperimentCount,
      resumeCount: session.resumeCount + 1,
      stoppedReason: "",
      updatedAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId,
      type: "session.resumed",
      message: "Resumed session.",
      payload: {
        targetExperimentCount:
          targetExperimentCount ?? session.targetExperimentCount,
      },
    });
  },
});

export const requestMoreExperiments = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    count: v.float64(),
  },
  handler: async (ctx, args) => {
    const count = normalizeInteger(args.count, "count", 1, 1000);
    const session = await mustGetSession(ctx, args.sessionId);
    const queued = await ctx.db
      .query("researchExperiments")
      .withIndex("by_session_status", (q) =>
        q.eq("sessionId", args.sessionId).eq("status", "queued"),
      )
      .collect();
    const plannedCount =
      session.completedExperimentCount + session.activeRunCount + queued.length;
    const baseline =
      session.status === "completed" || session.status === "stopped"
        ? plannedCount
        : Math.max(session.targetExperimentCount, plannedCount);
    const nextTarget = baseline + count;
    const now = nowUtc();

    await ctx.db.patch(args.sessionId, {
      status: "running",
      targetExperimentCount: nextTarget,
      resumeCount:
        session.status === "running"
          ? session.resumeCount
          : session.resumeCount + 1,
      stoppedReason: "",
      updatedAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId: args.sessionId,
      type: "session.more_requested",
      message: `Requested ${count} more experiments.`,
      payload: { count, targetExperimentCount: nextTarget },
    });
    return { targetExperimentCount: nextTarget };
  },
});

export const rollbackSession = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    targetExperimentId: v.optional(v.id("researchExperiments")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await mustGetSession(ctx, args.sessionId);
    const now = nowUtc();
    const experiments = (
      await ctx.db
        .query("researchExperiments")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .collect()
    ).sort((a, b) => a.ordinal - b.ordinal);
    const runs = await ctx.db
      .query("researchRuns")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const patches = await ctx.db
      .query("researchPatches")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const target = args.targetExperimentId
      ? experiments.find((experiment) => experiment._id === args.targetExperimentId)
      : undefined;
    if (args.targetExperimentId && !target) {
      throw new Error("rollback target does not belong to this session");
    }
    if (target && !isCompletedStatus(target.status)) {
      throw new Error("rollback target must be a completed experiment");
    }

    const targetOrdinal = target?.ordinal ?? 0;
    const rolledBackExperiments = experiments.filter(
      (experiment) => experiment.ordinal > targetOrdinal && experiment.status !== "rolled_back",
    );
    const rolledBackExperimentIds = new Set(
      rolledBackExperiments.map((experiment) => experiment._id),
    );
    const rolledBackRuns = runs.filter(
      (run) => rolledBackExperimentIds.has(run.experimentId) && run.status !== "rolled_back",
    );
    const rolledBackRunIds = new Set(rolledBackRuns.map((run) => run._id));

    for (const experiment of rolledBackExperiments) {
      await ctx.db.patch(experiment._id, {
        status: "rolled_back",
        promoted: false,
        activeRunId: undefined,
        updatedAtUtc: now,
      });
    }
    for (const run of rolledBackRuns) {
      await ctx.db.patch(run._id, {
        status: "rolled_back",
        finishedAtUtc: now,
        error: args.reason ?? "Rolled back by session control.",
      });
    }
    for (const patch of patches) {
      if (
        rolledBackExperimentIds.has(patch.experimentId) ||
        rolledBackRunIds.has(patch.runId)
      ) {
        await ctx.db.patch(patch._id, { status: "rolled_back" });
      }
    }

    const activePlanningCycles = await ctx.db
      .query("researchPlanningCycles")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    for (const cycle of activePlanningCycles.filter(
      (cycle) => cycle.sessionId === args.sessionId,
    )) {
      await ctx.db.patch(cycle._id, {
        status: "rolled_back",
        completedAtUtc: now,
        error: args.reason ?? "Rolled back by session control.",
      });
    }

    const keptCompleted = experiments.filter(
      (experiment) =>
        experiment.ordinal <= targetOrdinal && isCompletedStatus(experiment.status),
    );
    const best = bestExperimentForSession(session, keptCompleted);
    const promotionMilestoneIds = promotionMilestoneIdsForSession(
      session.metricContract,
      keptCompleted.map((experiment) => ({
        id: String(experiment._id),
        ordinal: experiment.ordinal,
        status: experiment.status,
        metrics: experiment.metrics,
        score: experiment.score,
      })),
    );

    for (const experiment of keptCompleted) {
      await ctx.db.patch(experiment._id, {
        promoted: promotionMilestoneIds.has(String(experiment._id)),
        updatedAtUtc: now,
      });
    }

    const basePatch = target
      ? patches
          .filter(
            (patch) =>
              patch.experimentId === target._id && patch.status === "accepted",
          )
          .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc))[0]
      : undefined;
    const nextOrdinal = Math.max(
      1,
      ...experiments.map((experiment) => experiment.ordinal + 1),
    );

    await ctx.db.patch(args.sessionId, {
      status: "running",
      activeRunCount: 0,
      completedExperimentCount: keptCompleted.length,
      nextExperimentOrdinal: nextOrdinal,
      bestExperimentId: best?.experiment._id,
      bestScore: best?.score,
      bestMetrics: best?.metrics,
      basePatchId: basePatch?._id,
      rollbackTargetExperimentId: target?._id,
      rollbackCount: (session.rollbackCount ?? 0) + 1,
      resumeCount:
        session.status === "running" ? session.resumeCount : session.resumeCount + 1,
      rolledBackAtUtc: now,
      stoppedReason: "",
      updatedAtUtc: now,
    });

    const rollbackId = await ctx.db.insert("researchRollbacks", {
      sessionId: args.sessionId,
      fromExperimentOrdinal: experiments.length
        ? Math.max(...experiments.map((experiment) => experiment.ordinal))
        : undefined,
      toExperimentOrdinal: target?.ordinal,
      targetExperimentId: target?._id,
      basePatchId: basePatch?._id,
      rolledBackExperimentIds: rolledBackExperiments.map((experiment) => experiment._id),
      rolledBackRunIds: rolledBackRuns.map((run) => run._id),
      reason: args.reason,
      createdAtUtc: now,
    });

    await insertEvent(ctx, {
      sessionId: args.sessionId,
      experimentId: target?._id,
      type: "session.rolled_back",
      message: target
        ? `Rolled back to experiment #${target.ordinal}.`
        : "Rolled back to the session root.",
      payload: {
        rollbackId,
        targetExperimentId: target?._id,
        basePatchId: basePatch?._id,
        rolledBackExperimentCount: rolledBackExperiments.length,
        rolledBackRunCount: rolledBackRuns.length,
      },
    });

    return {
      rollbackId,
      targetExperimentId: target?._id,
      basePatchId: basePatch?._id,
      rolledBackExperimentCount: rolledBackExperiments.length,
      rolledBackRunCount: rolledBackRuns.length,
    };
  },
});

export const setSessionConcurrency = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    maxConcurrentRuns: v.optional(v.float64()),
    maxPlannedConcurrentExperiments: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    if (
      args.maxConcurrentRuns === undefined &&
      args.maxPlannedConcurrentExperiments === undefined
    ) {
      throw new Error("setSessionConcurrency requires at least one concurrency value");
    }
    await mustGetSession(ctx, args.sessionId);
    const now = nowUtc();
    const patch: Record<string, unknown> = { updatedAtUtc: now };
    if (args.maxConcurrentRuns !== undefined) {
      patch.maxConcurrentRuns = normalizeInteger(
        args.maxConcurrentRuns,
        "maxConcurrentRuns",
        1,
        64,
      );
    }
    if (args.maxPlannedConcurrentExperiments !== undefined) {
      patch.maxPlannedConcurrentExperiments = normalizeInteger(
        args.maxPlannedConcurrentExperiments,
        "maxPlannedConcurrentExperiments",
        1,
        64,
      );
    }
    await ctx.db.patch(args.sessionId, patch);
    await insertEvent(ctx, {
      sessionId: args.sessionId,
      type: "session.concurrency_updated",
      message: "Updated session concurrency.",
      payload: patch,
    });
    return patch;
  },
});

export const setWorkerControl = mutation({
  args: {
    desiredRunnerCount: v.optional(v.float64()),
    desiredPlannerCount: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    if (
      args.desiredRunnerCount === undefined &&
      args.desiredPlannerCount === undefined
    ) {
      throw new Error("setWorkerControl requires at least one control value");
    }
    const now = nowUtc();
    const existing = await ctx.db
      .query("researchWorkerControls")
      .withIndex("by_key", (q) => q.eq("key", WORKER_CONTROL_KEY))
      .first();
    const desiredRunnerCount =
      args.desiredRunnerCount === undefined
        ? (existing?.desiredRunnerCount ?? 0)
        : normalizeInteger(args.desiredRunnerCount, "desiredRunnerCount", 0, 64);
    const desiredPlannerCount =
      args.desiredPlannerCount === undefined
        ? (existing?.desiredPlannerCount ?? 3)
        : normalizeInteger(args.desiredPlannerCount, "desiredPlannerCount", 1, 64);

    if (existing) {
      await ctx.db.patch(existing._id, {
        desiredRunnerCount,
        desiredPlannerCount,
        updatedAtUtc: now,
      });
      return existing._id;
    }

    return ctx.db.insert("researchWorkerControls", {
      key: WORKER_CONTROL_KEY,
      desiredRunnerCount,
      desiredPlannerCount,
      updatedAtUtc: now,
    });
  },
});

export const seedControlPlaneDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("researchSessions")
      .withIndex("by_slug", (q) => q.eq("slug", "local-pytorch-workshop"))
      .first();
    if (existing) {
      return existing._id;
    }
    const now = nowUtc();
    const sessionId = await ctx.db.insert("researchSessions", {
      slug: "local-pytorch-workshop",
      title: "Local PyTorch workshop",
      status: "running",
      repoPath: "../examples/pytorch-classifier",
      benchmarkCommand: "uv run python train.py",
      computeBudget: { seconds: DEFAULT_COMPUTE_BUDGET_SECONDS },
      targetExperimentCount: 6,
      maxConcurrentRuns: 1,
      maxPlannedConcurrentExperiments: 3,
      completedExperimentCount: 2,
      activeRunCount: 1,
      nextExperimentOrdinal: 1,
      resumeCount: 0,
      rollbackCount: 0,
      editablePaths: ["src/model.py", "configs/*.yaml"],
      immutablePaths: ["data/**", "eval.py", "metric_contract.yaml"],
      runtimeConfigPaths: ["configs/train.yaml", "configs/model.yaml"],
      modelIoContract:
        "Keep dataloader batch inputs unchanged and return the same prediction/loss output keys.",
      metricContract: normalizeMetricContract({
        rankingMode: "lexicographic",
        metrics: [
          {
            name: "validation_loss",
            direction: "minimize",
            role: "objective",
            weight: 1,
          },
          {
            name: "accuracy",
            direction: "maximize",
            role: "objective",
            weight: 0.25,
          },
          {
            name: "latency_ms",
            direction: "minimize",
            role: "constraint",
            max: 25,
          },
        ],
      }),
      createdAtUtc: now,
      updatedAtUtc: now,
    });

    const experimentSeeds: Array<{
      hypothesis: string;
      changeKind: string;
      status: "completed" | "running" | "queued";
      promoted?: boolean;
      metrics?: Record<string, number>;
      score?: number;
    }> = [
      {
        hypothesis: "Baseline ResNet-18 with default Adam optimizer.",
        changeKind: "baseline",
        status: "completed",
        metrics: {
          validation_loss: 0.4821,
          accuracy: 0.8412,
          latency_ms: 18.2,
        },
        score: -0.4821,
      },
      {
        hypothesis: "Reduce learning rate to 1e-4 with cosine schedule.",
        changeKind: "hyperparameter",
        status: "completed",
        promoted: true,
        metrics: {
          validation_loss: 0.4127,
          accuracy: 0.8643,
          latency_ms: 18.0,
        },
        score: -0.4127,
      },
      {
        hypothesis: "Add dropout=0.2 in classifier head to reduce overfitting.",
        changeKind: "architecture",
        status: "running",
      },
      {
        hypothesis: "Switch to label smoothing (epsilon=0.1).",
        changeKind: "loss",
        status: "queued",
      },
      {
        hypothesis: "Augment with RandAugment (n=2, m=9).",
        changeKind: "augmentation",
        status: "queued",
      },
      {
        hypothesis: "Try mixup with alpha=0.4.",
        changeKind: "augmentation",
        status: "queued",
      },
    ];

    const experimentIds: Id<"researchExperiments">[] = [];
    let promotedExperimentId: Id<"researchExperiments"> | undefined;
    let promotedMetrics: Record<string, number> | undefined;
    let promotedScore: number | undefined;

    for (let index = 0; index < experimentSeeds.length; index++) {
      const seed = experimentSeeds[index];
      const experimentId = await ctx.db.insert("researchExperiments", {
        sessionId,
        ordinal: index + 1,
        status: seed.status,
        changeKind: seed.changeKind,
        hypothesis: seed.hypothesis,
        prompt: seed.hypothesis,
        metrics: seed.metrics,
        score: seed.score,
        promoted: seed.promoted ?? false,
        createdAtUtc: now,
        updatedAtUtc: now,
      });
      experimentIds.push(experimentId);
      if (seed.promoted) {
        promotedExperimentId = experimentId;
        promotedMetrics = seed.metrics;
        promotedScore = seed.score;
      }
      await insertEvent(ctx, {
        sessionId,
        experimentId,
        type: "experiment.queued",
        message: seed.hypothesis,
        payload: { changeKind: seed.changeKind },
      });
    }

    // Planning cycle
    const planningCycleId = await ctx.db.insert("researchPlanningCycles", {
      sessionId,
      status: "completed",
      requestedCount: experimentSeeds.length,
      approvedCount: experimentSeeds.length,
      plannerWorkerId: "planner-local-1",
      plannerOutput:
        "Proposed 6 experiments spanning hyperparameters, architecture tweaks, and augmentation strategies.",
      reviewerOutput:
        "All 6 hypotheses approved. Constraints (latency_ms <= 25) verified.",
      startedAtUtc: now,
      completedAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId,
      type: "planning.batch_enqueued",
      message: `Queued ${experimentSeeds.length} planned experiments.`,
      payload: { planningCycleId, experimentIds },
    });

    // Completed run for promoted experiment + a patch
    if (promotedExperimentId) {
      const completedRunId = await ctx.db.insert("researchRuns", {
        sessionId,
        experimentId: promotedExperimentId,
        workerId: "runner-local-1",
        status: "completed",
        runNumber: 1,
        workspacePath:
          "../research/autoresearch_workspaces/local-pytorch-workshop/run-002",
        claimedAtUtc: now,
        startedAtUtc: now,
        finishedAtUtc: now,
        codexExitCode: 0,
        benchmarkExitCode: 0,
        metrics: promotedMetrics,
        score: promotedScore,
        summary:
          "Cosine schedule with lr=1e-4 lowered validation loss from 0.4821 to 0.4127.",
      });
      const patchId = await ctx.db.insert("researchPatches", {
        sessionId,
        experimentId: promotedExperimentId,
        runId: completedRunId,
        status: "accepted",
        workspacePath:
          "../research/autoresearch_workspaces/local-pytorch-workshop/run-002",
        changedFiles: ["configs/train.yaml", "src/model.py"],
        rejectedFiles: [],
        editablePaths: ["src/model.py", "configs/*.yaml"],
        immutablePaths: ["data/**", "eval.py", "metric_contract.yaml"],
        diff: "diff --git a/configs/train.yaml b/configs/train.yaml\n@@\n-learning_rate: 1e-3\n+learning_rate: 1e-4\n+lr_schedule: cosine\n",
        diffStat: "2 files changed, 2 insertions(+), 1 deletion(-)",
        contentHash: "a1b2c3d4e5f6789012345678",
        createdAtUtc: now,
      });
      await ctx.db.patch(completedRunId, { patchId });
      await ctx.db.patch(sessionId, {
        bestExperimentId: promotedExperimentId,
        bestScore: promotedScore,
        bestMetrics: promotedMetrics,
      });
    }

    // Active run for the running experiment
    const runningExperimentId = experimentIds[2];
    if (runningExperimentId) {
      const activeRunId = await ctx.db.insert("researchRuns", {
        sessionId,
        experimentId: runningExperimentId,
        workerId: "runner-local-1",
        status: "running",
        runNumber: 1,
        workspacePath:
          "../research/autoresearch_workspaces/local-pytorch-workshop/run-003",
        claimedAtUtc: now,
        startedAtUtc: now,
      });
      await ctx.db.patch(runningExperimentId, { activeRunId });
      await ctx.db.insert("researchRunLogs", {
        sessionId,
        experimentId: runningExperimentId,
        runId: activeRunId,
        stream: "stdout",
        sequence: 1,
        chunk: "Epoch 1/10 | loss=0.612 | acc=0.781\n",
        createdAtUtc: now,
      });
      await ctx.db.insert("researchRunLogs", {
        sessionId,
        experimentId: runningExperimentId,
        runId: activeRunId,
        stream: "stdout",
        sequence: 2,
        chunk: "Epoch 2/10 | loss=0.498 | acc=0.823\n",
        createdAtUtc: now,
      });
      await insertEvent(ctx, {
        sessionId,
        experimentId: runningExperimentId,
        runId: activeRunId,
        type: "run.started",
        message: "Started run in workspace run-003.",
      });
    }

    await ctx.db.patch(sessionId, {
      nextExperimentOrdinal: experimentSeeds.length + 1,
    });

    await insertEvent(ctx, {
      sessionId,
      type: "session.created",
      message: "Seeded local PyTorch workshop session.",
    });
    return sessionId;
  },
});

async function insertExperimentBatch(
  ctx: any,
  args: {
    sessionId: Id<"researchSessions">;
    experiments: Array<{
      hypothesis: string;
      changeKind: string;
      prompt?: string;
      sources?: Array<{
        title?: string;
        url?: string;
        kind?: string;
        citation?: string;
      }>;
    }>;
    planningCycleId?: Id<"researchPlanningCycles">;
  },
): Promise<Id<"researchExperiments">[]> {
  const session = await mustGetSession(ctx, args.sessionId);
  const now = nowUtc();
  const inserted: Id<"researchExperiments">[] = [];
  let ordinal = session.nextExperimentOrdinal;

  for (const item of args.experiments) {
    const experimentId = await ctx.db.insert("researchExperiments", {
      sessionId: args.sessionId,
      ordinal,
      status: "queued",
      changeKind: item.changeKind,
      hypothesis: item.hypothesis,
      prompt: item.prompt ?? "",
      sources: item.sources,
      promoted: false,
      createdAtUtc: now,
      updatedAtUtc: now,
    });
    inserted.push(experimentId);
    ordinal += 1;
    await insertEvent(ctx, {
      sessionId: args.sessionId,
      experimentId,
      type: "experiment.queued",
      message: item.hypothesis,
      payload: {
        planningCycleId: args.planningCycleId,
        changeKind: item.changeKind,
      },
    });
  }

  await ctx.db.patch(args.sessionId, {
    nextExperimentOrdinal: ordinal,
    updatedAtUtc: now,
  });
  if (args.planningCycleId) {
    await ctx.db.patch(args.planningCycleId, {
      status: "completed",
      approvedCount: inserted.length,
      completedAtUtc: now,
    });
  }
  await insertEvent(ctx, {
    sessionId: args.sessionId,
    type: "planning.batch_enqueued",
    message: `Queued ${inserted.length} planned experiments.`,
    payload: { planningCycleId: args.planningCycleId, experimentIds: inserted },
  });
  return inserted;
}

async function firstRunnableSession(
  ctx: any,
): Promise<Doc<"researchSessions"> | null> {
  const sessions = await ctx.db
    .query("researchSessions")
    .withIndex("by_status", (q: any) => q.eq("status", "running"))
    .collect();
  for (const session of sessions.sort(
    (a: Doc<"researchSessions">, b: Doc<"researchSessions">) =>
      a.updatedAtUtc.localeCompare(b.updatedAtUtc),
  )) {
    const queued = await ctx.db
      .query("researchExperiments")
      .withIndex("by_session_status", (q: any) =>
        q.eq("sessionId", session._id).eq("status", "queued"),
      )
      .collect();
    const remaining =
      session.targetExperimentCount -
      session.completedExperimentCount -
      session.activeRunCount -
      queued.length;
    if (remaining > 0) {
      return session;
    }
  }
  return null;
}

async function activePlanningCyclesForSession(
  ctx: any,
  sessionId: Id<"researchSessions">,
  now: string,
): Promise<Doc<"researchPlanningCycles">[]> {
  const runningCycles = await ctx.db
    .query("researchPlanningCycles")
    .withIndex("by_status", (q: any) => q.eq("status", "running"))
    .collect();
  const active: Doc<"researchPlanningCycles">[] = [];

  for (const cycle of runningCycles.filter(
    (item: Doc<"researchPlanningCycles">) => item.sessionId === sessionId,
  )) {
    if (!isStalePlanningCycle(cycle, now)) {
      active.push(cycle);
      continue;
    }

    await ctx.db.patch(cycle._id, {
      status: "failed",
      error: "Planning cycle expired without completion.",
      completedAtUtc: now,
    });
    await insertEvent(ctx, {
      sessionId,
      type: "planning.expired",
      message: "Expired stale planning cycle.",
      payload: {
        planningCycleId: cycle._id,
        plannerWorkerId: cycle.plannerWorkerId,
        startedAtUtc: cycle.startedAtUtc,
      },
    });
  }

  return active;
}

function isStalePlanningCycle(
  cycle: Doc<"researchPlanningCycles">,
  now: string,
): boolean {
  const startedAtMs = Date.parse(cycle.startedAtUtc);
  const nowMs = Date.parse(now);
  return (
    Number.isFinite(startedAtMs) &&
    Number.isFinite(nowMs) &&
    nowMs - startedAtMs > PLANNING_CYCLE_STALE_MS
  );
}

async function nextRunNumber(
  ctx: any,
  experimentId: Id<"researchExperiments">,
): Promise<number> {
  const runs = await ctx.db
    .query("researchRuns")
    .withIndex("by_experiment", (q: any) => q.eq("experimentId", experimentId))
    .collect();
  return runs.length + 1;
}

async function mustGetSession(
  ctx: any,
  sessionId: Id<"researchSessions">,
): Promise<Doc<"researchSessions">> {
  const session = await ctx.db.get(sessionId);
  if (!session) {
    throw new Error(`missing research session ${sessionId}`);
  }
  return session;
}

async function mustGetExperiment(
  ctx: any,
  experimentId: Id<"researchExperiments">,
): Promise<Doc<"researchExperiments">> {
  const experiment = await ctx.db.get(experimentId);
  if (!experiment) {
    throw new Error(`missing research experiment ${experimentId}`);
  }
  return experiment;
}

async function mustGetRun(
  ctx: any,
  runId: Id<"researchRuns">,
): Promise<Doc<"researchRuns">> {
  const run = await ctx.db.get(runId);
  if (!run) {
    throw new Error(`missing research run ${runId}`);
  }
  return run;
}

async function patchSessionStatus(
  ctx: any,
  sessionId: Id<"researchSessions">,
  status: string,
  eventType: string,
  message: string,
  stoppedReason?: string,
) {
  await ctx.db.patch(sessionId, {
    status,
    stoppedReason: stoppedReason ?? "",
    updatedAtUtc: nowUtc(),
  });
  await insertEvent(ctx, { sessionId, type: eventType, message });
}

async function insertEvent(
  ctx: any,
  args: {
    sessionId: Id<"researchSessions">;
    experimentId?: Id<"researchExperiments">;
    runId?: Id<"researchRuns">;
    type: string;
    message: string;
    payload?: unknown;
  },
) {
  await ctx.db.insert("researchEvents", {
    ...args,
    createdAtUtc: nowUtc(),
  });
}

function scoreMetrics(contract: any, metrics: Record<string, number>): number {
  const rankingMode = String(contract?.rankingMode ?? "single_primary");
  const metricSpecs = objectiveMetricSpecs(contract);
  const primaryMetric = topObjectiveMetric(contract);

  if (rankingMode === "lexicographic") {
    return metricSpecs.reduce((total: number, spec: any, index: number) => {
      const value = metrics[String(spec.name)];
      if (typeof value !== "number") {
        return total;
      }
      const direction = String(spec.direction ?? "minimize");
      const signed = direction === "maximize" ? value : -value;
      return total + signed / Math.pow(1000, index);
    }, 0);
  }

  if (rankingMode === "weighted_score") {
    return metricSpecs.reduce((total: number, spec: any) => {
      const value = metrics[String(spec.name)];
      if (typeof value !== "number") {
        return total;
      }
      const direction = String(spec.direction ?? "minimize");
      const signed = direction === "maximize" ? value : -value;
      return total + signed * Number(spec.weight ?? 1);
    }, 0);
  }

  const primaryValue = metrics[primaryMetric];
  if (typeof primaryValue !== "number") {
    return Number.NEGATIVE_INFINITY;
  }
  const primarySpec = metricSpecs.find(
    (spec: any) => String(spec.name) === primaryMetric,
  );
  return String(primarySpec?.direction ?? "minimize") === "maximize"
    ? primaryValue
    : -primaryValue;
}

function isNewBest(
  session: Doc<"researchSessions">,
  score: number,
  metrics: Record<string, number>,
): boolean {
  if (!constraintsPass(session.metricContract, metrics)) {
    return false;
  }
  if (String(session.metricContract?.rankingMode ?? "") === "lexicographic") {
    return lexicographicMetricsImprove(
      session.metricContract,
      metrics,
      session.bestMetrics,
    );
  }
  return session.bestScore === undefined || score > session.bestScore;
}

function isCompletedStatus(status: string): boolean {
  return status === "completed" || status === "complete" || status === "ok";
}

function failureReasonForExperiment(
  experiment: Doc<"researchExperiments">,
  runs: Doc<"researchRuns">[],
  patches: Doc<"researchPatches">[],
): string | undefined {
  if (experiment.status !== "failed") {
    return undefined;
  }

  const latestRuns = runs
    .filter((run) => run.experimentId === experiment._id)
    .sort((a, b) => b.runNumber - a.runNumber);
  const failedRun =
    latestRuns.find((run) => run.status === "failed" || Boolean(run.error)) ??
    latestRuns[0];

  const runError = compactFailureReason(failedRun?.error);
  if (runError) {
    return runError;
  }

  const rejectedPatch = patches.find(
    (patch) => patch.experimentId === experiment._id && patch.rejectionReason,
  );
  const patchReason = compactFailureReason(rejectedPatch?.rejectionReason);
  if (patchReason) {
    return patchReason;
  }

  if (failedRun?.benchmarkExitCode !== undefined && failedRun.benchmarkExitCode !== 0) {
    return `benchmark exited with ${failedRun.benchmarkExitCode}`;
  }

  if (failedRun?.codexExitCode !== undefined && failedRun.codexExitCode !== 0) {
    return `agent exited with ${failedRun.codexExitCode}`;
  }

  return "reason not recorded";
}

function compactFailureReason(reason: unknown): string | undefined {
  const text = String(reason ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function bestExperimentForSession(
  session: Doc<"researchSessions">,
  experiments: Array<Doc<"researchExperiments">>,
):
  | {
      experiment: Doc<"researchExperiments">;
      score: number;
      metrics: Record<string, number>;
    }
  | undefined {
  let best:
    | {
        experiment: Doc<"researchExperiments">;
        score: number;
        metrics: Record<string, number>;
      }
    | undefined;

  for (const experiment of experiments) {
    const metrics = experiment.metrics;
    if (!metrics || !constraintsPass(session.metricContract, metrics)) {
      continue;
    }
    const score = typeof experiment.score === "number"
      ? experiment.score
      : scoreMetrics(session.metricContract, metrics);
    if (!best) {
      best = { experiment, score, metrics };
      continue;
    }
    const improves =
      String(session.metricContract?.rankingMode ?? "") === "lexicographic"
        ? lexicographicMetricsImprove(session.metricContract, metrics, best.metrics)
        : score > best.score;
    if (improves) {
      best = { experiment, score, metrics };
    }
  }

  return best;
}

function lexicographicMetricsImprove(
  contract: any,
  candidate: Record<string, number>,
  current: Record<string, number> | undefined,
): boolean {
  if (!current) {
    return true;
  }
  const specs = objectiveMetricSpecs(contract);
  for (const spec of specs) {
    const name = String(spec.name);
    const candidateValue = candidate[name];
    const currentValue = current[name];
    if (typeof candidateValue !== "number") {
      return false;
    }
    if (typeof currentValue !== "number") {
      return true;
    }
    const tolerance = Number(spec.tolerance ?? spec.tieTolerance ?? 0);
    const direction = String(spec.direction ?? "minimize");
    const delta = candidateValue - currentValue;
    if (Math.abs(delta) <= tolerance) {
      continue;
    }
    return direction === "maximize" ? delta > 0 : delta < 0;
  }
  return false;
}

function normalizeComputeBudget(value: any): any {
  if (value === undefined || value === null || value === "") {
    return { seconds: DEFAULT_COMPUTE_BUDGET_SECONDS };
  }
  if (typeof value === "number" || typeof value === "string") {
    return { seconds: parseDurationSeconds(value, "computeBudget") };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("computeBudget must be an object, number of seconds, or duration string");
  }

  const secondsValue =
    value.seconds ??
    value.durationSeconds ??
    value.benchmarkSeconds ??
    value.benchmarkTimeoutSeconds;
  const minutesValue = value.minutes ?? value.durationMinutes;
  const seconds =
    secondsValue !== undefined && secondsValue !== null && secondsValue !== ""
      ? parseDurationSeconds(secondsValue, "computeBudget.seconds")
      : minutesValue !== undefined && minutesValue !== null && minutesValue !== ""
        ? parseDurationMinutes(minutesValue, "computeBudget.minutes")
        : DEFAULT_COMPUTE_BUDGET_SECONDS;
  return { ...value, seconds };
}

function normalizeMemoryConfig(value: any): any {
  if (value === undefined || value === null || value === "") {
    value = {};
  }
  if (typeof value === "boolean") {
    value = { enabled: value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("memory must be an object or boolean when provided");
  }
  const enabled = value.enabled === undefined || value.enabled === null
    ? true
    : requireBoolean(value.enabled, "memory.enabled");
  return {
    ...value,
    enabled,
    rootPath: optionalString(value.rootPath) ?? "research",
    researcher: normalizeMemoryRoleConfig(value.researcher, enabled, "memory.researcher"),
    memoryKeeper: normalizeMemoryRoleConfig(value.memoryKeeper, enabled, "memory.memoryKeeper"),
  };
}

function normalizeMemoryRoleConfig(value: any, defaultEnabled: boolean, field: string): any {
  if (value === undefined || value === null || value === "") {
    return { enabled: defaultEnabled };
  }
  if (typeof value === "boolean") {
    return { enabled: value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object or boolean when provided`);
  }
  const enabled = value.enabled === undefined || value.enabled === null
    ? defaultEnabled
    : requireBoolean(value.enabled, `${field}.enabled`);
  return { ...value, enabled };
}

function requireBoolean(value: any, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function normalizeSandboxConfig(value: any): any {
  if (value === undefined || value === null || value === "") {
    return { environment: "none", backend: "direct" };
  }
  if (typeof value === "string") {
    return normalizeSandboxConfig({ environment: value });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("sandbox must be an object or environment string when provided");
  }
  const rawEnvironment =
    optionalString(value.environment) ??
    optionalString(value.provider) ??
    optionalString(value.backend) ??
    "none";
  const environment = normalizeSandboxEnvironment(rawEnvironment, "sandbox.environment");
  const rawBackend = optionalString(value.backend)?.toLowerCase();
  if (
    rawBackend !== undefined &&
    rawBackend !== "sandcastle" &&
    rawBackend !== "direct" &&
    rawBackend !== "none" &&
    rawBackend !== "local" &&
    rawBackend !== "docker" &&
    rawBackend !== "podman" &&
    rawBackend !== "vercel"
  ) {
    throw new Error(
      "sandbox.backend must be none, local, direct, sandcastle, docker, podman, or vercel",
    );
  }
  const provider = optionalString(value.provider)?.toLowerCase();
  if (
    provider !== undefined &&
    provider !== "none" &&
    provider !== "local" &&
    provider !== "docker" &&
    provider !== "podman" &&
    provider !== "vercel"
  ) {
    throw new Error("sandbox.provider must be none, docker, podman, or vercel");
  }

  const backend = environment === "none" ? "direct" : "sandcastle";
  const normalized = { ...value, environment, backend };
  if (environment === "none") {
    delete normalized.provider;
  } else {
    normalized.provider = environment;
  }
  return normalized;
}

function normalizeSandboxEnvironment(value: unknown, field: string): string {
  const environment = String(value).trim().toLowerCase();
  if (environment === "local" || environment === "direct") {
    return "none";
  }
  if (
    environment !== "none" &&
    environment !== "docker" &&
    environment !== "podman" &&
    environment !== "vercel" &&
    environment !== "sandcastle"
  ) {
    throw new Error(`${field} must be none, docker, podman, or vercel`);
  }
  return environment === "sandcastle" ? "docker" : environment;
}

function parseDurationSeconds(value: unknown, field: string): number {
  if (typeof value === "number") {
    return requiredPositiveDurationSeconds(value, field);
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a positive duration`);
  }
  const trimmed = value.trim().toLowerCase();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return requiredPositiveDurationSeconds(numeric, field);
  }
  const match = trimmed.match(
    /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/,
  );
  if (!match) {
    throw new Error(`${field} must be a positive duration like 300, "300s", or "5m"`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1;
  return requiredPositiveDurationSeconds(amount * multiplier, field);
}

function parseDurationMinutes(value: unknown, field: string): number {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) {
    throw new Error(`${field} must be a positive number of minutes`);
  }
  return requiredPositiveDurationSeconds(minutes * 60, field);
}

function requiredPositiveDurationSeconds(value: unknown, field: string): number {
  const seconds = Math.ceil(Number(value));
  if (!Number.isFinite(seconds) || seconds < 1) {
    throw new Error(`${field} must be at least 1 second`);
  }
  return seconds;
}

function normalizeMetricContract(contract: any): any {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error("metricContract must be an object");
  }
  const topLevelDirection = optionalMetricDirection(
    contract.direction,
    "metricContract.direction",
  );
  const metrics = Array.isArray(contract.metrics)
    ? contract.metrics.map((spec: any, index: number) =>
        normalizeMetricSpec(spec, index, topLevelDirection)
      )
    : [];
  const topObjective = metrics.find((spec: any) => isObjectiveMetricSpec(spec));
  const explicitPrimaryMetric = optionalString(contract.primaryMetric);
  const rankingMode =
    contract.rankingMode ?? (explicitPrimaryMetric ? undefined : "lexicographic");
  const primaryMetric =
    rankingMode === "lexicographic"
      ? topObjective?.name ?? explicitPrimaryMetric
      : explicitPrimaryMetric ?? topObjective?.name;
  if (!primaryMetric) {
    throw new Error(
      "metricContract must include primaryMetric or at least one objective metric",
    );
  }
  const primarySpec = metrics.find((spec: any) => spec.name === primaryMetric);
  const direction = topLevelDirection ?? primarySpec?.direction ?? topObjective?.direction;
  if (!direction) {
    throw new Error(
      "metricContract.direction or the top objective direction must be minimize or maximize",
    );
  }
  return {
    ...contract,
    primaryMetric,
    direction,
    ...(rankingMode === undefined ? {} : { rankingMode }),
    metrics: metrics.length > 0 ? metrics : [{ name: primaryMetric, direction }],
  };
}

function normalizeMetricSpec(
  spec: any,
  index: number,
  fallbackDirection: "maximize" | "minimize" | undefined,
) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`metricContract.metrics[${index}] must be an object`);
  }
  const name = requiredString(spec.name, `metricContract.metrics[${index}].name`);
  const direction =
    optionalMetricDirection(
      spec.direction,
      `metricContract.metrics[${index}].direction`,
    ) ??
    fallbackDirection ??
    "minimize";
  return { ...spec, name, direction };
}

function optionalMetricDirection(
  value: unknown,
  field: string,
): "maximize" | "minimize" | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const direction = String(value).trim().toLowerCase();
  if (direction !== "minimize" && direction !== "maximize") {
    throw new Error(`${field} must be minimize or maximize`);
  }
  return direction;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("optional string field must be a string");
  }
  return value.trim();
}

function objectiveMetricSpecs(contract: any): any[] {
  const specs = Array.isArray(contract?.metrics) ? contract.metrics : [];
  const objectives = specs.filter((spec: any) => isObjectiveMetricSpec(spec));
  if (objectives.length > 0) {
    return objectives;
  }
  const primaryMetric =
    typeof contract?.primaryMetric === "string" && contract.primaryMetric.trim()
      ? contract.primaryMetric.trim()
      : undefined;
  if (!primaryMetric) {
    return [];
  }
  return [{ name: primaryMetric, direction: contract?.direction ?? "minimize" }];
}

function topObjectiveMetric(contract: any): string {
  const objectiveName = objectiveMetricSpecs(contract)[0]?.name;
  if (String(contract?.rankingMode ?? "") === "lexicographic") {
    return String(objectiveName ?? contract?.primaryMetric ?? "objective");
  }
  return String(
    contract?.primaryMetric ?? objectiveName ?? "objective",
  );
}

function isObjectiveMetricSpec(spec: any): boolean {
  return String(spec?.role ?? "objective") !== "constraint";
}

function constraintsPass(
  contract: any,
  metrics: Record<string, number>,
): boolean {
  const specs = Array.isArray(contract?.metrics) ? contract.metrics : [];
  for (const spec of specs) {
    if (String(spec.role ?? "") !== "constraint") {
      continue;
    }
    const value = metrics[String(spec.name)];
    if (typeof value !== "number") {
      return false;
    }
    if (typeof spec.min === "number" && value < spec.min) {
      return false;
    }
    if (typeof spec.max === "number" && value > spec.max) {
      return false;
    }
  }
  return true;
}

function shouldEarlyStop(
  session: Doc<"researchSessions">,
  promoted: boolean,
  nextCompleted: number,
): boolean {
  const config = session.earlyStopping;
  if (!config || config.enabled !== true) {
    return false;
  }
  if (promoted) {
    return false;
  }
  const patience = Number(config.patience ?? 0);
  if (!Number.isFinite(patience) || patience <= 0) {
    return false;
  }
  return nextCompleted >= patience;
}

type AgentUsageRow = {
  role: string;
  source: string;
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

function summarizeAgentUsage(rows: AgentUsageRow[]) {
  const totals = emptyUsageSummary();
  const byRole: Record<string, ReturnType<typeof emptyUsageSummary>> = {};
  const bySource: Record<string, ReturnType<typeof emptyUsageSummary>> = {};
  for (const row of rows) {
    addUsage(totals, row);
    addUsage(byRole[row.role] ??= emptyUsageSummary(), row);
    addUsage(bySource[row.source] ??= emptyUsageSummary(), row);
  }
  return { totals, byRole, bySource };
}

function emptyUsageSummary() {
  return {
    calls: 0,
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function addUsage(target: ReturnType<typeof emptyUsageSummary>, row: AgentUsageRow) {
  target.calls += 1;
  target.inputTokens += row.inputTokens ?? 0;
  target.cacheCreationInputTokens += row.cacheCreationInputTokens ?? 0;
  target.cacheReadInputTokens += row.cacheReadInputTokens ?? 0;
  target.outputTokens += row.outputTokens ?? 0;
  target.totalTokens +=
    row.totalTokens ??
    sumDefined([
      row.inputTokens,
      row.cacheCreationInputTokens,
      row.cacheReadInputTokens,
      row.outputTokens,
    ]) ??
    0;
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => typeof value === "number");
  if (numbers.length === 0) {
    return undefined;
  }
  return numbers.reduce((sum, value) => sum + value, 0);
}

function normalizeInteger(
  value: number,
  fieldName: string,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be finite`);
  }
  const integer = Math.trunc(value);
  if (integer < min || integer > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }
  return integer;
}

function nowUtc(): string {
  return new Date().toISOString();
}
