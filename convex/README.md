# Convex Backend

This folder contains the Convex backend for Autoresearch.

## Local Development

Use a local Convex deployment while building:

```bash
npm run convex:dev:local
```

That command runs `convex dev --local`, starts a local backend process, and writes
the generated `VITE_CONVEX_URL` value to `.env.local`. Keep it running while the
Vite frontend is open.

Seed starter data after the local backend is running:

```bash
npm run convex:seed
```

## Autoresearch Control Plane

`orchestration.ts` contains the Convex-first research workflow:

- `researchSessions`: session contracts, target experiment count, editable
  surfaces, metric contract, status, continuation state.
- `researchExperiments`: queued and completed hypotheses.
- `researchRuns`: local worker attempts for an experiment.
- `researchRunLogs`: streamed agent and benchmark output.
- `researchAgentMessages`: persisted agent/runner messages for the UI.
- `researchEvents`: append-only lifecycle events.
- `researchPatches`: changed files, git diff, diff stat, hash, and rejection
  reason for every agent edit attempt.
- `researchArtifacts`: rendered run artifacts. TikZ diagrams are stored here as
  PNG bytes only; PDFs are temporary compile intermediates and are not
  persisted.
- `researchPlanningCycles`: researcher/planner/reviewer batches that enqueue
  independent experiments for parallel execution.

Use `npm run orchestrator:codex` to plan and review experiment batches, then use
`npm run runner:codex` to consume queued experiments. The runner uses the
session's `agent.provider` through Sandcastle's agent-provider interface. It runs
directly on the host by default, or in Sandcastle when the registered session has
`sandbox.backend: "sandcastle"` or the runner process sets
`AUTORESEARCH_RUNNER_BACKEND=sandcastle`.

External projects register sessions through
`orchestration.registerResearchSession`. The CLI reads a session directory,
normalizes relative `repoPath` values to absolute paths, and sends the session
contract to that mutation.

`researchWorkerControls` stores the desired local runner count. The browser
updates this row, and `npm run dev:stack` keeps one orchestrator running per
active session while reconciling the runner count into local agent subprocesses.

The runner records a patch after the agent edits and before benchmarks run. A run can
complete only when it references an accepted patch, so metrics are always linked
to a concrete code state.

When a session has a `memory` block, the orchestrator runs an optional read-only
researcher before the planner and stores its output with the planning cycle. The
runner runs an optional memory keeper after completed or internally failed runs
to update the configured repo-local research notes.
