# Autoresearch

Autoresearch is a local control plane for running bounded AI research sessions
against any repository. It provides:

- a Convex backend for sessions, queues, runs, patches, logs, and metrics
- a React dashboard for supervising sessions and workers
- local Codex planner and runner processes
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

Sign in to Codex before running real workers:

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

Create a session directory in any project:

```text
my-session/
  session.json
  goal.md
  metric_contract.md
```

Register it:

```bash
autoresearch register /path/to/my-session
```

See [docs/session-dir.md](docs/session-dir.md) and
[examples/basic-session/session.json](examples/basic-session/session.json).

## Session Contract

The required runtime fields are:

- `slug`
- `title`
- `repoPath`
- `benchmarkCommand`
- `targetExperimentCount`
- `maxConcurrentRuns`
- `editablePaths`
- `metricContract.primaryMetric`
- `metricContract.direction`

`repoPath` is resolved relative to the session directory when registered.
Editable and immutable paths are relative to the target repo.

The benchmark command runs inside an isolated workspace. Metrics are parsed from
the last JSON object in benchmark output or from `metric_name: 1.23` lines.

## Useful Commands

```bash
autoresearch dev
autoresearch register ./my-session
autoresearch runner --once
autoresearch orchestrator --once
```

Package scripts are also available:

```bash
npm run dev:stack
npm run convex:dev:local
npm run convex:seed
npm run build
```
