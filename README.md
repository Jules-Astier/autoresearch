# Autoresearch

Autoresearch is a local control plane for running bounded AI research sessions
against any repository. It provides:

- a Convex backend for sessions, queues, runs, patches, logs, and metrics
- a React dashboard for supervising sessions and workers
- local planner and runner processes
- optional researcher and memory-keeper roles for durable research context
- a generic `session.json` contract that can be registered from anywhere

The target project stays in its own repository. Autoresearch only needs a session
directory that declares the repo path, benchmark command, editable surfaces, and
metric contract.

## Install

```bash
npm install
```

For local CLI use from this checkout:

```bash
npm link
```

Sign in to the agent CLI you plan to use before running real workers. Codex is
the default agent provider:

```bash
codex --login
```

## Run

Start the local Convex backend, React app, planner supervisor, and runner
supervisor:

```bash
autoresearch dev
```

The first Convex run writes `VITE_CONVEX_URL` to `.env.local`. Local Convex state
lives under `.convex/` and is intentionally ignored by git.

## Register A Session

Initialize Autoresearch files inside a target project:

```bash
cd /path/to/target-project
autoresearch init
```

This creates `.autoresearch/` with setup docs for users and agents, plus a
reference session at `.autoresearch/sessions/example`.

Print an exact setup guide and starter `session.json` for a session folder:

```bash
autoresearch session guide ./my-session --repo-path ../target-project
```

Create a session directory in any project:

```text
my-session/
  session.json          # required
  goal.md               # recommended
  metric_contract.md    # recommended
  prompts/              # optional
  context/              # optional
  baselines/            # optional
  references/           # optional
```

Register it:

```bash
autoresearch session add /path/to/my-session
```

See [docs/session-dir.md](docs/session-dir.md) and
[examples/basic-session/session.json](examples/basic-session/session.json).

## Session Contract

The required runtime fields are:

- `slug`
- `title`
- `repoPath`
- `benchmarkCommand`
- `computeBudget` (optional, defaults to 5 minutes)
- `targetExperimentCount`
- `maxConcurrentRuns`
- `maxPlannedConcurrentExperiments` (optional, defaults to 3)
- `editablePaths`
- `metricContract.metrics`

Metric contracts use the order of `metrics` as the objective priority when
`rankingMode` is `lexicographic`. The first objective is also stored as
`primaryMetric`/`direction` for compatibility with older sessions.

`repoPath` is resolved relative to the session directory when registered.
Editable and immutable paths are relative to the target repo.

The benchmark command runs inside an isolated workspace under
`~/.autoresearch/runner` by default. Sessions can opt into Sandcastle-backed
Docker, Podman, or Vercel execution for agent and benchmark runs, and can select
`codex`, `claude-code`, `opencode`, or `pi` for each role under `agent`.
Metrics are parsed from the last JSON object in benchmark output or from
`metric_name: 1.23` lines.

`computeBudget` controls how long the runner lets each benchmark execute. Omit
it for the 5 minute default, or set `"computeBudget": { "seconds": 600 }`. The
benchmark process also receives `AUTORESEARCH_COMPUTE_BUDGET_SECONDS`.

`maxPlannedConcurrentExperiments` controls planner batch size for that session.
`sandbox.environment` selects where workers and benchmarks run: `none` for host
execution, or `docker`, `podman`, or `vercel` through Sandcastle.

Sessions can also opt into durable research memory with a `memory` block. The
researcher runs before planning to turn notes and references into candidate
hypotheses; the memory keeper runs after each run to update repo-local notes,
duplicate warnings, and campaign context.

Top-level `agent.provider`/`agent.model` are defaults for `researcher`,
`planner`, `reviewer`, `worker`, and `memoryKeeper`. Override a role with
`agent.planner.model`, `agent.worker.provider`, etc., or with process overrides
such as `AUTORESEARCH_PLANNER_AGENT_MODEL`.

## TikZ Diagrams

Architecture-change experiments must create or update a TikZ source diagram in
the target repo. Add an editable `.tex` path or glob such as
`figures/**/*.tex` to `editablePaths`; the source file may be created by the
worker when it is missing. The agent edits only `.tex` diagram sources. Keep
rendered `figures/**/*.pdf` and `figures/**/*.png` immutable. The local runner
compiles changed TikZ sources after an accepted patch, uses the PDF only as a
temporary intermediate, and stores only the PNG in Convex `researchArtifacts`.

Verify the local TeX toolchain before running architecture sessions:

```bash
autoresearch doctor
```

On macOS, install the required BasicTeX packages explicitly:

```bash
autoresearch install-tex --macos
```

## Useful Commands

```bash
autoresearch dev
autoresearch init
autoresearch session guide ./my-session --repo-path ../target-project
autoresearch session add ./my-session
autoresearch session add ./my-session --dry-run
autoresearch doctor
autoresearch runner --once
autoresearch orchestrator --once
```

Package scripts are also available:

```bash
npm run dev:stack
npm run doctor
npm run install-tex:macos
npm run convex:dev:local
npm run convex:seed
npm run build
```
