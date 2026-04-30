import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    sessionId: v.string(),
    title: v.string(),
    sessionRoot: v.string(),
    checkout: v.string(),
    status: v.string(),
    completedExperiments: v.float64(),
    promotedCount: v.float64(),
    primaryMetric: v.string(),
    metricDirections: v.record(v.string(), v.string()),
    bestMetrics: v.record(v.string(), v.float64()),
    maxExperiments: v.optional(v.float64()),
    heartbeatAtUtc: v.optional(v.string()),
    objective: v.optional(v.any())
  }).index("by_session_id", ["sessionId"]),

  experiments: defineTable({
    sessionId: v.string(),
    runId: v.string(),
    createdAt: v.string(),
    status: v.string(),
    experimentId: v.string(),
    hypothesis: v.string(),
    metrics: v.record(v.string(), v.float64()),
    promoted: v.boolean(),
    comment: v.string(),
    raw: v.record(v.string(), v.string())
  })
    .index("by_session", ["sessionId"])
    .index("by_session_run", ["sessionId", "runId"]),

  dagNodes: defineTable({
    sessionId: v.string(),
    runId: v.optional(v.string()),
    experimentId: v.optional(v.string()),
    hash: v.optional(v.string()),
    parentHash: v.optional(v.string()),
    candidateHash: v.optional(v.string()),
    status: v.optional(v.string()),
    promoted: v.optional(v.boolean()),
    isMaster: v.optional(v.boolean()),
    hypothesis: v.optional(v.string()),
    metrics: v.optional(v.record(v.string(), v.float64()))
  }).index("by_session", ["sessionId"]),

  sessionLogs: defineTable({
    sessionId: v.string(),
    stdoutTail: v.string(),
    stderrTail: v.string(),
    updatedAtUtc: v.string()
  }).index("by_session", ["sessionId"]),

  researchSessions: defineTable({
    slug: v.string(),
    title: v.string(),
    status: v.string(),
    repoPath: v.string(),
    baseRef: v.optional(v.string()),
    benchmarkCommand: v.string(),
    metricParserCommand: v.optional(v.string()),
    targetExperimentCount: v.float64(),
    maxConcurrentRuns: v.float64(),
    completedExperimentCount: v.float64(),
    activeRunCount: v.float64(),
    nextExperimentOrdinal: v.float64(),
    resumeCount: v.float64(),
    editablePaths: v.array(v.string()),
    immutablePaths: v.array(v.string()),
    runtimeConfigPaths: v.array(v.string()),
    modelIoContract: v.optional(v.string()),
    agent: v.optional(v.any()),
    metricContract: v.any(),
    sandbox: v.optional(v.any()),
    earlyStopping: v.optional(v.any()),
    bestExperimentId: v.optional(v.id("researchExperiments")),
    bestScore: v.optional(v.float64()),
    bestMetrics: v.optional(v.record(v.string(), v.float64())),
    basePatchId: v.optional(v.id("researchPatches")),
    rollbackTargetExperimentId: v.optional(v.id("researchExperiments")),
    rollbackCount: v.optional(v.float64()),
    rolledBackAtUtc: v.optional(v.string()),
    stoppedReason: v.optional(v.string()),
    createdAtUtc: v.string(),
    updatedAtUtc: v.string()
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"]),

  researchExperiments: defineTable({
    sessionId: v.id("researchSessions"),
    ordinal: v.float64(),
    status: v.string(),
    changeKind: v.string(),
    hypothesis: v.string(),
    prompt: v.string(),
    activeRunId: v.optional(v.id("researchRuns")),
    metrics: v.optional(v.record(v.string(), v.float64())),
    score: v.optional(v.float64()),
    promoted: v.boolean(),
    createdAtUtc: v.string(),
    updatedAtUtc: v.string()
  })
    .index("by_session", ["sessionId"])
    .index("by_session_status", ["sessionId", "status"])
    .index("by_session_ordinal", ["sessionId", "ordinal"]),

  researchRuns: defineTable({
    sessionId: v.id("researchSessions"),
    experimentId: v.id("researchExperiments"),
    patchId: v.optional(v.id("researchPatches")),
    workerId: v.string(),
    status: v.string(),
    runNumber: v.float64(),
    workspacePath: v.optional(v.string()),
    claimedAtUtc: v.string(),
    startedAtUtc: v.optional(v.string()),
    finishedAtUtc: v.optional(v.string()),
    codexExitCode: v.optional(v.float64()),
    benchmarkExitCode: v.optional(v.float64()),
    metrics: v.optional(v.record(v.string(), v.float64())),
    score: v.optional(v.float64()),
    summary: v.optional(v.string()),
    error: v.optional(v.string())
  })
    .index("by_session", ["sessionId"])
    .index("by_experiment", ["experimentId"])
    .index("by_status", ["status"]),

  researchPatches: defineTable({
    sessionId: v.id("researchSessions"),
    experimentId: v.id("researchExperiments"),
    runId: v.id("researchRuns"),
    status: v.string(),
    baseRef: v.optional(v.string()),
    workspacePath: v.string(),
    changedFiles: v.array(v.string()),
    rejectedFiles: v.array(v.string()),
    editablePaths: v.array(v.string()),
    immutablePaths: v.array(v.string()),
    diff: v.string(),
    diffStat: v.string(),
    contentHash: v.string(),
    rejectionReason: v.optional(v.string()),
    createdAtUtc: v.string()
  })
    .index("by_run", ["runId"])
    .index("by_experiment", ["experimentId"])
    .index("by_session", ["sessionId", "createdAtUtc"]),

  researchArtifacts: defineTable({
    sessionId: v.id("researchSessions"),
    experimentId: v.id("researchExperiments"),
    runId: v.id("researchRuns"),
    kind: v.string(),
    sourcePath: v.string(),
    path: v.string(),
    mimeType: v.string(),
    byteLength: v.float64(),
    bytes: v.bytes(),
    contentHash: v.string(),
    createdAtUtc: v.string()
  })
    .index("by_run", ["runId", "createdAtUtc"])
    .index("by_experiment", ["experimentId", "createdAtUtc"])
    .index("by_session", ["sessionId", "createdAtUtc"]),

  researchPlanningCycles: defineTable({
    sessionId: v.id("researchSessions"),
    status: v.string(),
    requestedCount: v.float64(),
    approvedCount: v.optional(v.float64()),
    plannerWorkerId: v.string(),
    prompt: v.optional(v.string()),
    plannerOutput: v.optional(v.string()),
    reviewerOutput: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAtUtc: v.string(),
    completedAtUtc: v.optional(v.string())
  })
    .index("by_session", ["sessionId", "startedAtUtc"])
    .index("by_status", ["status"]),

  researchWorkerControls: defineTable({
    key: v.string(),
    desiredPlannerCount: v.optional(v.float64()),
    desiredRunnerCount: v.float64(),
    updatedAtUtc: v.string()
  }).index("by_key", ["key"]),

  researchRunLogs: defineTable({
    sessionId: v.id("researchSessions"),
    experimentId: v.id("researchExperiments"),
    runId: v.id("researchRuns"),
    stream: v.string(),
    sequence: v.float64(),
    chunk: v.string(),
    createdAtUtc: v.string()
  })
    .index("by_run", ["runId", "sequence"])
    .index("by_session", ["sessionId", "createdAtUtc"]),

  researchAgentMessages: defineTable({
    sessionId: v.id("researchSessions"),
    experimentId: v.optional(v.id("researchExperiments")),
    runId: v.optional(v.id("researchRuns")),
    role: v.string(),
    source: v.string(),
    content: v.string(),
    sequence: v.float64(),
    createdAtUtc: v.string()
  })
    .index("by_session", ["sessionId", "createdAtUtc"])
    .index("by_experiment", ["experimentId", "sequence"])
    .index("by_run", ["runId", "sequence"]),

  researchEvents: defineTable({
    sessionId: v.id("researchSessions"),
    experimentId: v.optional(v.id("researchExperiments")),
    runId: v.optional(v.id("researchRuns")),
    type: v.string(),
    message: v.string(),
    payload: v.optional(v.any()),
    createdAtUtc: v.string()
  })
    .index("by_session", ["sessionId", "createdAtUtc"])
    .index("by_run", ["runId", "createdAtUtc"]),

  researchRollbacks: defineTable({
    sessionId: v.id("researchSessions"),
    fromExperimentOrdinal: v.optional(v.float64()),
    toExperimentOrdinal: v.optional(v.float64()),
    targetExperimentId: v.optional(v.id("researchExperiments")),
    basePatchId: v.optional(v.id("researchPatches")),
    rolledBackExperimentIds: v.array(v.id("researchExperiments")),
    rolledBackRunIds: v.array(v.id("researchRuns")),
    reason: v.optional(v.string()),
    createdAtUtc: v.string()
  })
    .index("by_session", ["sessionId", "createdAtUtc"])
  });
