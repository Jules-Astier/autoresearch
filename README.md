# Autoresearch

Autoresearch is a local control plane for running bounded AI research sessions
against any repository. It provides:

- a Convex backend for sessions, queues, runs, patches, logs, and metrics
- a React dashboard for supervising sessions and workers
- local planner and runner processes
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
- `metricContract.metrics`

Metric contracts use the order of `metrics` as the objective priority when
`rankingMode` is `lexicographic`. The first objective is also stored as
`primaryMetric`/`direction` for compatibility with older sessions.

`repoPath` is resolved relative to the session directory when registered.
Editable and immutable paths are relative to the target repo.

The benchmark command runs inside an isolated workspace. Sessions can opt into a
Sandcastle-backed Docker or Podman sandbox for agent and benchmark execution,
and can select `codex`, `claude-code`, `opencode`, or `pi` as the worker agent.
Metrics are parsed from the last JSON object in benchmark output or from
`metric_name: 1.23` lines.

## TikZ Diagrams

Architecture-change experiments can keep a TikZ source diagram in the target
repo, for example `figures/model_architecture.tex`. Add the `.tex` source to
`editablePaths`; keep rendered `figures/**/*.pdf` and `figures/**/*.png`
immutable. The runner compiles changed TikZ sources after an accepted patch,
uses the PDF only as a temporary intermediate, and stores only the PNG in
Convex `researchArtifacts`.

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
autoresearch register ./my-session
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
